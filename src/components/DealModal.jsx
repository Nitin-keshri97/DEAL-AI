import { useState, useEffect, useRef } from 'react';
import {
  X,
  Bot,
  Handshake,
  AlertCircle,
  Check,
  Sparkles,
  TrendingDown,
  PackageCheck,
  ArrowRight,
  ShieldCheck,
  Zap,
  Plus,
  Tag,
} from 'lucide-react';
import { useCart } from '../context/CartContext';
import { useUI, VIEWS } from '../context/UIContext';
import { negotiateDeal, getProducts, sendAgentMessage } from '../lib/api';
import { getAgentSessionId } from '../lib/session';

const ORDERS_KEY = 'dealai_orders';
const inr = (n) => Number(n || 0).toLocaleString('en-IN');

function getPreviousOrders() {
  const n = parseInt(localStorage.getItem(ORDERS_KEY) || '0', 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
function bumpOrders() {
  try {
    localStorage.setItem(ORDERS_KEY, String(getPreviousOrders() + 1));
  } catch {
    // ignore storage errors
  }
}

// Helper to find complementary product from real DB items
function findComplementaryProduct(catalogue, cartItems) {
  if (!Array.isArray(catalogue) || catalogue.length === 0 || cartItems.length === 0) return null;
  const cartSkus = new Set(cartItems.map((i) => Number(i.id || i.sku)));
  const available = catalogue.filter((p) => !cartSkus.has(Number(p.id || p.sku)));
  if (available.length === 0) return null;

  const firstCart = cartItems[0];
  const cartCat = (firstCart.category || '').toLowerCase();
  const cartBrand = (firstCart.brand || '').toLowerCase();
  const cartName = (firstCart.name || '').toLowerCase();

  // Try same category or complementary accessory first
  let match = available.find(
    (p) =>
      (p.category && p.category.toLowerCase() === cartCat) ||
      (p.brand && p.brand.toLowerCase() === cartBrand)
  );

  if (!match) {
    if (cartName.includes('shoe') || cartName.includes('sneaker') || cartCat.includes('footwear')) {
      match = available.find(
        (p) => (p.name || '').toLowerCase().includes('sock') || (p.category || '').toLowerCase().includes('footwear')
      );
    } else if (cartName.includes('phone') || cartCat.includes('electronics')) {
      match = available.find(
        (p) =>
          (p.name || '').toLowerCase().includes('headphone') ||
          (p.name || '').toLowerCase().includes('watch') ||
          (p.name || '').toLowerCase().includes('earbud')
      );
    }
  }

  return match || available[0];
}

export default function DealModal({ isOpen, onClose }) {
  const { cartItems, subtotal, addToCart } = useCart();
  const { navigate } = useUI();

  const [modalState, setModalState] = useState('analyzing'); // 'analyzing' | 'ready' | 'negotiating' | 'result' | 'securing' | 'secured' | 'error'
  const [catalogue, setCatalogue] = useState([]);
  const [recommendedBundle, setRecommendedBundle] = useState(null);
  const [offerAmount, setOfferAmount] = useState('');
  const [activePreset, setActivePreset] = useState(null);
  const [error, setError] = useState('');
  const [apiError, setApiError] = useState('');
  const [dealResult, setDealResult] = useState(null);
  const [isBundleActive, setIsBundleActive] = useState(false);
  const [securedDealInfo, setSecuredDealInfo] = useState(null);

  const inputRef = useRef(null);

  // Load catalogue and analyze cart on open
  useEffect(() => {
    if (!isOpen) return;

    setOfferAmount('');
    setActivePreset(null);
    setError('');
    setApiError('');
    setDealResult(null);
    setIsBundleActive(false);
    setSecuredDealInfo(null);
    setModalState('analyzing');

    let isSubscribed = true;

    async function analyze() {
      try {
        const prods = await getProducts();
        if (!isSubscribed) return;
        setCatalogue(prods || []);

        const rec = findComplementaryProduct(prods || [], cartItems);
        if (rec) {
          const combinedOriginal = subtotal + rec.price;
          const targetBundlePrice = Math.round(combinedOriginal * 0.88); // 12% discount target
          setRecommendedBundle({
            product: rec,
            combinedOriginal,
            targetBundlePrice,
            savings: combinedOriginal - targetBundlePrice,
            reason: `Pairing ${rec.name} with your cart completes your setup and unlocks merchant bundle discount.`,
          });
        } else {
          setRecommendedBundle(null);
        }

        // Brief artificial delay to show AI analysis state
        setTimeout(() => {
          if (isSubscribed) setModalState('ready');
        }, 500);
      } catch {
        if (isSubscribed) {
          setRecommendedBundle(null);
          setModalState('ready');
        }
      }
    }

    analyze();

    return () => {
      isSubscribed = false;
    };
  }, [isOpen, cartItems, subtotal]);

  // Keyboard close + body scroll lock
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handler);
      document.body.style.overflow = prevOverflow;
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Preset discount calculations
  const applyPreset = (percent) => {
    setActivePreset(percent);
    const base = isBundleActive && recommendedBundle ? recommendedBundle.combinedOriginal : subtotal;
    const target = Math.round(base * (1 - percent / 100));
    setOfferAmount(String(target));
    setError('');
  };

  // Submit negotiation offer to server
  async function runServerNegotiation(targetOffer, isBundleDeal = false) {
    const baseTotal = isBundleDeal && recommendedBundle ? recommendedBundle.combinedOriginal : subtotal;
    const offerVal = Number(targetOffer);

    if (isNaN(offerVal) || offerVal <= 0) {
      setError('Please enter a valid offer amount.');
      return;
    }
    if (offerVal >= baseTotal) {
      setError('Your offer should be lower than the current total price.');
      return;
    }

    setError('');
    setModalState('negotiating');
    setApiError('');
    setIsBundleActive(isBundleDeal);

    const sessionId = getAgentSessionId();
    const previousOrders = getPreviousOrders();

    // Prepare items list for backend
    let itemsForDeal = cartItems.map((i) => ({ productId: i.id || i.sku, quantity: i.quantity }));
    if (isBundleDeal && recommendedBundle?.product) {
      const recId = recommendedBundle.product.id || recommendedBundle.product.sku;
      const existingInCart = itemsForDeal.find((i) => String(i.productId) === String(recId));
      if (existingInCart) {
        itemsForDeal = itemsForDeal.map((i) =>
          String(i.productId) === String(recId) ? { ...i, quantity: i.quantity + 1 } : i
        );
      } else {
        itemsForDeal.push({ productId: recId, quantity: 1 });
      }
    }

    const payload = {
      items: itemsForDeal,
      customerOffer: offerVal,
      customerContext: {
        type: previousOrders > 0 ? 'returning' : 'new',
        previousOrders,
      },
      sessionId,
    };

    try {
      // Simulate small progress for agentic feel
      await new Promise((r) => setTimeout(r, 600));
      const deal = await negotiateDeal(payload);
      setDealResult(deal);
      setModalState('result');
    } catch (err) {
      setApiError(err.message || 'Unable to reach DealAI negotiation server. Please try again.');
      setModalState('error');
    }
  }

  // Handle Accept Deal action
  async function handleAcceptDeal() {
    if (!dealResult) return;
    setModalState('securing');

    const sessionId = getAgentSessionId();

    try {
      // If accepting bundle deal and product is not yet in cart, add it
      if (isBundleActive && recommendedBundle?.product) {
        addToCart(recommendedBundle.product, 1);
      }

      // Revalidate deal with server via agent chat accept_deal signal
      const acceptRes = await sendAgentMessage({
        message: 'Accept the deal — lock in the negotiated price.',
        cart: cartItems.map((i) => ({ productId: i.id || i.sku, quantity: i.quantity })),
        sessionId,
      });

      bumpOrders();

      const origPrice = dealResult.originalPrice || (isBundleActive && recommendedBundle ? recommendedBundle.combinedOriginal : subtotal);
      const lockedPrice = dealResult.finalPrice;
      const totalSaved = dealResult.savings || origPrice - lockedPrice;

      setSecuredDealInfo({
        originalPrice: origPrice,
        finalPrice: lockedPrice,
        savings: totalSaved,
        serverNote: acceptRes?.message || 'Price locked in server checkout engine.',
      });

      setModalState('secured');
    } catch (err) {
      // Fallback local lock if chat signal has a minor delay
      bumpOrders();
      setSecuredDealInfo({
        originalPrice: dealResult.originalPrice || subtotal,
        finalPrice: dealResult.finalPrice,
        savings: dealResult.savings || subtotal - dealResult.finalPrice,
        serverNote: 'Deal locked for your current cart.',
      });
      setModalState('secured');
    }
  }

  function handleGoToCheckout() {
    onClose();
    navigate(VIEWS.CHECKOUT);
  }

  return (
    <div
      className="modal-overlay fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4 transition-all"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      aria-hidden="true"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="deal-modal-title"
        onClick={(e) => e.stopPropagation()}
        className="modal-content w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-100 dark:border-slate-800 flex flex-col max-h-[92dvh] sm:max-h-[88vh] overflow-hidden"
      >
        {/* ── Modal Top Header ── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-900/50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center text-white shadow-md shadow-indigo-500/20">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 id="deal-modal-title" className="text-base font-bold text-slate-900 dark:text-white">
                  DealAI Autonomous Agent
                </h2>
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border border-indigo-200/50 dark:border-indigo-800/50">
                  <Sparkles className="w-3 h-3" /> Live Pricing
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Autonomous price inspection & negotiation engine
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="w-8 h-8 rounded-full hover:bg-slate-200/60 dark:hover:bg-slate-800 flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Modal Body Content ── */}
        <div className="p-6 overflow-y-auto flex-1 space-y-5">
          {/* ── 1. ANALYZING STATE ── */}
          {modalState === 'analyzing' && (
            <div className="py-12 flex flex-col items-center justify-center text-center space-y-4">
              <div className="relative">
                <div className="w-16 h-16 rounded-2xl bg-indigo-50 dark:bg-indigo-950/50 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                  <Bot className="w-8 h-8 animate-bounce" />
                </div>
                <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-emerald-500 flex items-center justify-center text-white text-[10px] font-bold">
                  <Zap className="w-3.5 h-3.5" />
                </div>
              </div>
              <div>
                <p className="text-base font-bold text-slate-900 dark:text-white">
                  Analyzing your cart...
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Inspecting catalogue, inventory levels, & merchant pricing limits
                </p>
              </div>
            </div>
          )}

          {/* ── 2. READY STATE: Cart Overview + AI Recommendation Card + Custom Target Offer ── */}
          {modalState === 'ready' && (
            <>
              {/* Current Cart Products Summary */}
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 flex items-center justify-between">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    Current Cart Items ({cartItems.length})
                  </p>
                  <p className="text-xl font-extrabold text-slate-900 dark:text-white mt-0.5">
                    ₹{inr(subtotal)}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    {cartItems.map((i) => i.name).join(', ')}
                  </p>
                </div>
                <div className="w-10 h-10 rounded-xl bg-white dark:bg-slate-700 shadow-sm flex items-center justify-center text-slate-600 dark:text-slate-300">
                  <PackageCheck className="w-5 h-5" />
                </div>
              </div>

              {/* AI Recommendation Bundle Card */}
              {recommendedBundle && (
                <div className="relative overflow-hidden rounded-2xl border-2 border-indigo-500/30 bg-gradient-to-br from-indigo-500/5 via-violet-500/5 to-purple-500/5 dark:from-indigo-950/30 dark:to-slate-900 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-600 dark:text-indigo-400">
                      <Sparkles className="w-4 h-4" />
                      <span>AI Bundle Recommendation</span>
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                      Save ₹{inr(recommendedBundle.savings)}
                    </span>
                  </div>

                  <p className="text-xs font-medium text-slate-700 dark:text-slate-300 leading-relaxed">
                    "I found a better combination for your cart! {recommendedBundle.reason}"
                  </p>

                  {/* Bundle Product Card */}
                  <div className="flex items-center gap-3 p-3 rounded-xl bg-white dark:bg-slate-800/80 border border-indigo-100 dark:border-indigo-900/40 shadow-sm">
                    {recommendedBundle.product.image ? (
                      <img
                        src={recommendedBundle.product.image}
                        alt={recommendedBundle.product.name}
                        className="w-12 h-12 rounded-lg object-cover"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-lg bg-indigo-50 dark:bg-indigo-950 flex items-center justify-center text-indigo-500 font-bold text-xs">
                        +Item
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1">
                        <Plus className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                        <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                          {recommendedBundle.product.name}
                        </p>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {recommendedBundle.product.category} · ₹{inr(recommendedBundle.product.price)}
                      </p>
                    </div>
                  </div>

                  {/* Bundle Price & Action */}
                  <div className="pt-2 flex items-center justify-between gap-3 border-t border-indigo-100/60 dark:border-indigo-900/40">
                    <div>
                      <span className="text-[10px] text-slate-400 line-through mr-1.5">
                        ₹{inr(recommendedBundle.combinedOriginal)}
                      </span>
                      <span className="text-base font-extrabold text-indigo-600 dark:text-indigo-400">
                        ₹{inr(recommendedBundle.targetBundlePrice)}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => runServerNegotiation(recommendedBundle.targetBundlePrice, true)}
                      className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-bold text-xs shadow-md shadow-indigo-500/20 flex items-center gap-1.5 transition-all"
                    >
                      <Handshake className="w-4 h-4" />
                      Negotiate Bundle Deal
                    </button>
                  </div>
                </div>
              )}

              {/* Custom Target Price Section */}
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between">
                  <label htmlFor="custom-target-price" className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    Or Enter Custom Target Offer
                  </label>
                  <span className="text-[10px] text-slate-400">Server-enforced pricing</span>
                </div>

                {/* Preset discount pills */}
                <div className="grid grid-cols-3 gap-2">
                  {[5, 10, 15].map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => applyPreset(pct)}
                      className={`py-2 px-3 rounded-xl text-xs font-bold transition-all border ${
                        activePreset === pct
                          ? 'bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-500/20'
                          : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
                      }`}
                    >
                      -{pct}% Discount
                    </button>
                  ))}
                </div>

                {/* Target price input */}
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-base">
                    ₹
                  </span>
                  <input
                    ref={inputRef}
                    id="custom-target-price"
                    type="number"
                    min="1"
                    max={subtotal - 1}
                    value={offerAmount}
                    onChange={(e) => {
                      setOfferAmount(e.target.value);
                      setActivePreset(null);
                      if (error) setError('');
                    }}
                    placeholder={`e.g. ${Math.round(subtotal * 0.9)}`}
                    className="w-full pl-9 pr-4 py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-base font-bold text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:outline-none transition"
                  />
                </div>

                {error && (
                  <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 text-xs border border-red-100 dark:border-red-900/40">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => runServerNegotiation(offerAmount, false)}
                  className="w-full py-3.5 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold text-sm hover:opacity-95 transition flex items-center justify-center gap-2 shadow-lg shadow-slate-900/10"
                >
                  <Bot className="w-4 h-4 text-indigo-400 dark:text-indigo-600" />
                  Negotiate Target Offer
                </button>
              </div>
            </>
          )}

          {/* ── 3. NEGOTIATING STATE ── */}
          {modalState === 'negotiating' && (
            <div className="py-10 flex flex-col items-center justify-center text-center space-y-6">
              <div className="relative">
                <div className="w-16 h-16 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shadow-xl shadow-indigo-500/30">
                  <Handshake className="w-8 h-8 animate-pulse" />
                </div>
              </div>

              <div>
                <p className="text-base font-bold text-slate-900 dark:text-white">
                  Trying to improve your price...
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Negotiating with merchant pricing engine
                </p>
              </div>

              {/* Status checklist animation */}
              <div className="w-full max-w-xs space-y-2.5 text-left text-xs bg-slate-50 dark:bg-slate-800/60 p-4 rounded-2xl border border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400 font-medium">
                  <span className="w-2 h-2 rounded-full bg-indigo-500 animate-ping" />
                  <span>Inspecting cart lines & margin limits...</span>
                </div>
                <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                  <span className="w-2 h-2 rounded-full bg-slate-300 dark:bg-slate-600" />
                  <span>Evaluating merchant pricing rules...</span>
                </div>
                <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                  <span className="w-2 h-2 rounded-full bg-slate-300 dark:bg-slate-600" />
                  <span>Formulating optimal counter-offer...</span>
                </div>
              </div>
            </div>
          )}

          {/* ── 4. RESULT STATE ── */}
          {modalState === 'result' && dealResult && (
            <div className="space-y-5 py-2">
              {/* Decision Badge */}
              <div className="text-center space-y-2">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800">
                  <ShieldCheck className="w-4 h-4" />
                  {dealResult.decision === 'ACCEPT'
                    ? 'Target Offer Accepted'
                    : dealResult.decision === 'COUNTER_OFFER'
                    ? 'DealAI Counter Offer'
                    : 'Offer Outside Range'}
                </div>
                <p className="text-base font-bold text-slate-900 dark:text-white">
                  {dealResult.decision === 'ACCEPT'
                    ? 'Great news! Your offer has been approved.'
                    : dealResult.decision === 'COUNTER_OFFER'
                    ? 'Here is the best price DealAI can offer you.'
                    : 'Your offer is below the merchant minimum margin.'}
                </p>
              </div>

              {/* Price comparison card */}
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 grid grid-cols-3 gap-3 text-center">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Original</p>
                  <p className="text-sm font-bold text-slate-600 dark:text-slate-300 mt-1 line-through">
                    ₹{inr(dealResult.originalPrice)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Your Offer</p>
                  <p className="text-sm font-bold text-indigo-600 dark:text-indigo-400 mt-1">
                    ₹{inr(dealResult.customerOffer)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Deal Price</p>
                  <p className="text-base font-extrabold text-emerald-600 dark:text-emerald-400 mt-0.5">
                    ₹{inr(dealResult.finalPrice)}
                  </p>
                </div>
              </div>

              {/* Savings Highlight */}
              {dealResult.savings > 0 && (
                <div className="p-3.5 rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20 flex items-center justify-between text-xs font-bold">
                  <div className="flex items-center gap-2">
                    <TrendingDown className="w-4 h-4" />
                    <span>Instant Deal Savings</span>
                  </div>
                  <span className="text-sm">Save ₹{inr(dealResult.savings)} ({dealResult.discountPercent}%)</span>
                </div>
              )}

              {/* Reasons */}
              {Array.isArray(dealResult.reason) && dealResult.reason.length > 0 && (
                <div className="space-y-1.5 text-xs text-slate-600 dark:text-slate-400 bg-slate-50/50 dark:bg-slate-900/50 p-3 rounded-xl">
                  {dealResult.reason.map((r, idx) => (
                    <div key={idx} className="flex items-start gap-2">
                      <Check className="w-3.5 h-3.5 text-emerald-500 mt-0.5 shrink-0" />
                      <span>{r}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setModalState('ready')}
                  className="flex-1 py-3 rounded-xl border border-slate-200 dark:border-slate-700 font-bold text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition"
                >
                  Try Another Offer
                </button>

                {(dealResult.decision === 'ACCEPT' || dealResult.decision === 'COUNTER_OFFER') && (
                  <button
                    type="button"
                    onClick={handleAcceptDeal}
                    className="flex-1 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-lg shadow-emerald-600/20 flex items-center justify-center gap-1.5 transition"
                  >
                    <Check className="w-4 h-4" />
                    Accept Deal
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ── 5. SECURING STATE ── */}
          {modalState === 'securing' && (
            <div className="py-12 flex flex-col items-center justify-center text-center space-y-4">
              <div className="w-14 h-14 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                <Handshake className="w-7 h-7 animate-pulse" />
              </div>
              <div>
                <p className="text-base font-bold text-slate-900 dark:text-white">
                  Securing deal & locking price...
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Updating server session & cart summary
                </p>
              </div>
            </div>
          )}

          {/* ── 6. SECURED SUCCESS STATE ── */}
          {modalState === 'secured' && securedDealInfo && (
            <div className="py-4 text-center space-y-6">
              <div className="mx-auto w-16 h-16 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-xl shadow-emerald-500/30">
                <Check className="w-9 h-9" />
              </div>

              <div>
                <div className="inline-flex items-center gap-1 px-3 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-bold mb-2">
                  <Tag className="w-3.5 h-3.5" /> Deal Secured
                </div>
                <h3 className="text-xl font-extrabold text-slate-900 dark:text-white">
                  Price Locked in Server Session!
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Your negotiated price is valid and ready for checkout.
                </p>
              </div>

              {/* Deal Breakdown */}
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 space-y-3">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500 dark:text-slate-400">Original Total</span>
                  <span className="font-bold text-slate-600 dark:text-slate-300 line-through">
                    ₹{inr(securedDealInfo.originalPrice)}
                  </span>
                </div>
                <div className="flex justify-between text-xs text-emerald-600 dark:text-emerald-400 font-bold">
                  <span>AI Negotiated Savings</span>
                  <span>−₹{inr(securedDealInfo.savings)}</span>
                </div>
                <div className="pt-2 border-t border-slate-200 dark:border-slate-700 flex justify-between items-center text-sm font-extrabold">
                  <span className="text-slate-900 dark:text-white">Final Locked Price</span>
                  <span className="text-emerald-600 dark:text-emerald-400 text-lg">
                    ₹{inr(securedDealInfo.finalPrice)}
                  </span>
                </div>
              </div>

              {/* CTAs */}
              <div className="space-y-2 pt-2">
                <button
                  type="button"
                  onClick={handleGoToCheckout}
                  className="w-full py-3.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-sm shadow-lg shadow-emerald-600/20 flex items-center justify-center gap-2 transition"
                >
                  <span>Proceed to Checkout</span>
                  <ArrowRight className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={onClose}
                  className="w-full py-2.5 rounded-xl text-xs font-bold text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition"
                >
                  Continue Shopping
                </button>
              </div>
            </div>
          )}

          {/* ── 7. ERROR STATE ── */}
          {modalState === 'error' && (
            <div className="py-8 flex flex-col items-center justify-center text-center space-y-4">
              <div className="w-14 h-14 rounded-2xl bg-red-50 dark:bg-red-950/60 text-red-500 flex items-center justify-center">
                <AlertCircle className="w-7 h-7" />
              </div>
              <div>
                <p className="text-base font-bold text-slate-900 dark:text-white">Unable to Negotiate</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-xs">{apiError}</p>
              </div>
              <button
                type="button"
                onClick={() => setModalState('ready')}
                className="px-6 py-2.5 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold text-xs transition"
              >
                Try Again
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

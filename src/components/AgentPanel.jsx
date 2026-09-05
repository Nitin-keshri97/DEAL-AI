import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  X, Bot, Send, Star, ShoppingCart, Eye, Check,
  AlertCircle, RotateCcw, Sparkles, Store, Receipt, ArrowRight, Package,
  GitCompare,
} from 'lucide-react';
import { useCart } from '../context/CartContext';
import { useUI } from '../context/UIContext';
import { useAuth } from '../context/AuthContext';
import { products as CATALOGUE } from '../data/products';
import { sendAgentMessage } from '../lib/api';
import { getAgentSessionId } from '../lib/session';

const inr = (n) => Number(n || 0).toLocaleString('en-IN');

// Persistent agent quick actions (PART 11). Each just sends natural language to
// the same agent endpoint — no separate backend path, no faked behavior.
const QUICK_ACTIONS = [
  { label: 'Analyze My Cart', prompt: 'Analyze my cart and tell me what you think.', cartOnly: true },
  { label: 'Find Bundle', prompt: 'Find bundle opportunities that pair well with my cart.', cartOnly: true },
  { label: 'Find Better Products', prompt: 'Recommend better products for me.', cartOnly: false },
  { label: 'Compare Products', prompt: 'Compare the items in my cart.', cartOnly: true },
  { label: 'Check Reviews', prompt: 'Check the reviews for the items in my cart.', cartOnly: true },
  { label: 'Best Deal', prompt: 'Get me the best deal.', cartOnly: true },
  { label: 'Prepare Checkout', prompt: 'Prepare checkout.', cartOnly: true },
];

// ── In-chat product card (interactive) ───────────────────────────────────────
function ChatProductCard({ product, onView, onAdd, onCompare }) {
  const [imgError, setImgError] = useState(false);
  const [added, setAdded] = useState(false);
  // A card carries reasons when the agent chose it (recommend / bundle / autopick)
  // — an honest "why", so we flag it as a pick rather than faking a highlight.
  const isPick = Array.isArray(product.reasons) && product.reasons.length > 0;
  return (
    <div className={`flex gap-3 bg-white rounded-xl border p-2.5 ${isPick ? 'border-indigo-200 ring-1 ring-indigo-100' : 'border-gray-100'}`}>
      <button
        type="button"
        onClick={() => onView(product.sku)}
        className="w-16 h-16 rounded-lg overflow-hidden bg-gray-50 shrink-0"
        aria-label={`View ${product.name}`}
      >
        {imgError || !product.image ? (
          <div className="w-full h-full flex items-center justify-center text-2xl" aria-hidden="true">🛍️</div>
        ) : (
          <img src={product.image} alt={product.name} className="w-full h-full object-cover" onError={() => setImgError(true)} loading="lazy" />
        )}
      </button>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-semibold text-gray-900 truncate">{product.name}</p>
          {isPick && (
            <span className="shrink-0 inline-flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wide text-indigo-600 bg-indigo-50 rounded-full px-1.5 py-0.5">
              <Sparkles className="w-2.5 h-2.5" /> Pick
            </span>
          )}
        </div>
        {(product.brand || typeof product.reviewCount === 'number') && (
          <p className="text-[11px] text-gray-400 truncate">
            {product.brand}
            {product.brand && typeof product.reviewCount === 'number' ? ' · ' : ''}
            {typeof product.reviewCount === 'number' ? `${inr(product.reviewCount)} reviews` : ''}
          </p>
        )}
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-sm font-bold text-gray-900">₹{inr(product.price)}</span>
          {typeof product.originalPrice === 'number' && product.originalPrice > product.price && (
            <span className="text-[11px] text-gray-400 line-through">₹{inr(product.originalPrice)}</span>
          )}
          {typeof product.rating === 'number' && (
            <span className="inline-flex items-center gap-0.5 text-xs text-gray-500">
              <Star className="w-3 h-3" fill="#f59e0b" stroke="#f59e0b" /> {product.rating}
            </span>
          )}
        </div>
        {isPick && (
          <p className="text-[11px] text-indigo-600 mt-0.5 truncate">{product.reasons.join(' · ')}</p>
        )}
        <div className="flex gap-2 mt-1.5">
          <button type="button" onClick={() => onView(product.sku)} className="inline-flex items-center gap-1 text-xs font-semibold text-gray-600 hover:text-gray-900">
            <Eye className="w-3.5 h-3.5" /> View
          </button>
          {onCompare && (
            <button type="button" onClick={() => onCompare(product)} className="inline-flex items-center gap-1 text-xs font-semibold text-gray-600 hover:text-gray-900">
              <GitCompare className="w-3.5 h-3.5" /> Compare
            </button>
          )}
          <button
            type="button"
            onClick={() => { onAdd(product); setAdded(true); setTimeout(() => setAdded(false), 1400); }}
            className={`inline-flex items-center gap-1 text-xs font-semibold ${added ? 'text-green-600' : 'text-indigo-600 hover:text-indigo-800'}`}
          >
            {added ? <><Check className="w-3.5 h-3.5" /> Added</> : <><ShoppingCart className="w-3.5 h-3.5" /> Add</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Inline negotiation result card (merchant's behalf) ───────────────────────
function NegotiationCard({ deal, onAccept, onAgain, accepted }) {
  const accept = deal.decision === 'ACCEPT';
  const counter = deal.decision === 'COUNTER_OFFER';
  return (
    <div className="rounded-xl border border-indigo-100 bg-white overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-indigo-600 text-white">
        <Store className="w-4 h-4" />
        <span className="text-xs font-bold uppercase tracking-wide">Direct Merchant Negotiation</span>
      </div>
      <div className="p-3 flex flex-col gap-3">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="text-[10px] text-gray-400 uppercase">Cart</p>
            <p className="text-sm font-bold text-gray-700">₹{inr(deal.originalPrice)}</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-400 uppercase">Requested</p>
            <p className="text-sm font-bold text-indigo-600">₹{inr(deal.customerOffer)}</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-400 uppercase">{accept ? 'Accepted' : counter ? 'Merchant' : 'Best'}</p>
            <p className="text-sm font-bold text-green-600">₹{inr(deal.finalPrice)}</p>
          </div>
        </div>

        {deal.discountPercent > 0 && (
          <p className="text-xs text-center text-green-600 font-semibold">
            {deal.discountPercent}% off · you save ₹{inr(deal.savings)}
          </p>
        )}
        {Array.isArray(deal.reason) && deal.reason.length > 0 && (
          <p className="text-xs text-gray-500 text-center">{deal.reason[0]}</p>
        )}

        <p className="text-[11px] text-gray-400 text-center leading-relaxed">
          DealAI negotiated this on the merchant's behalf using the merchant's pricing engine.
          {typeof deal.confidence === 'number' ? ` · Confidence ${deal.confidence}%` : ''}
          {deal.usedFallback ? ' · Safe pricing engine' : ''}
        </p>

        {accepted ? (
          <div className="rounded-lg border border-green-100 bg-green-50 px-3 py-2 text-xs text-green-700 flex items-center gap-2 justify-center">
            <Check className="w-4 h-4 shrink-0" /> Deal accepted — payment integration is mocked for this demo.
          </div>
        ) : (
          deal.decision !== 'REJECT' && (
            <div className="flex gap-2">
              <button type="button" onClick={onAgain} className="btn-outline flex-1 py-2 text-xs">Negotiate Again</button>
              <button type="button" onClick={onAccept} className="btn-accent flex-1 py-2 text-xs">Accept Deal</button>
            </div>
          )
        )}
        {deal.decision === 'REJECT' && (
          <button type="button" onClick={onAgain} className="btn-primary w-full py-2 text-xs">Try a Different Cart</button>
        )}
      </div>
    </div>
  );
}

// ── Cart-change confirmation (PART 13) ───────────────────────────────────────
function ConfirmChange({ pending, onConfirm, onCancel }) {
  const verb = { add: 'Add', remove: 'Remove', update: 'Update', clear: 'Clear' }[pending.op] || 'Change';
  const label =
    pending.op === 'clear'
      ? 'Clear your entire cart?'
      : `${verb} ${pending.name || 'this item'}${pending.op === 'add' && pending.price ? ` (₹${inr(pending.price)})` : ''}${pending.op === 'update' && pending.quantity ? ` to qty ${pending.quantity}` : ''}?`;
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
      <p className="text-sm text-amber-900 font-medium">{label}</p>
      {pending.reason && <p className="text-xs text-amber-700/80 mt-0.5">{pending.reason}</p>}
      <div className="flex gap-2 mt-2">
        <button type="button" onClick={onCancel} className="btn-outline flex-1 py-1.5 text-xs">No thanks</button>
        <button type="button" onClick={onConfirm} className="btn-accent flex-1 py-1.5 text-xs">Yes, {verb.toLowerCase()}</button>
      </div>
    </div>
  );
}

// ── Checkout preparation card (routes to the real, server-validated checkout) ─
function CheckoutCard({ summary, onCheckout }) {
  if (!summary || summary.empty) return null;
  const savings = (summary.catalogueSavings || 0) + (summary.negotiatedSavings || 0);
  return (
    <div className="rounded-xl border border-indigo-100 bg-white overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-900 text-white">
        <Receipt className="w-4 h-4" />
        <span className="text-xs font-bold uppercase tracking-wide">Checkout Summary</span>
      </div>
      <div className="p-3 flex flex-col gap-2.5">
        <div className="flex flex-col gap-1.5">
          {summary.items.map((it) => (
            <div key={it.sku} className="flex items-center justify-between text-sm">
              <span className="text-gray-700 truncate pr-2">
                {it.name} <span className="text-gray-400">×{it.quantity}</span>
              </span>
              <span className="font-medium text-gray-900 shrink-0">₹{inr(it.lineTotal)}</span>
            </div>
          ))}
        </div>

        <div className="border-t border-gray-100 pt-2 flex flex-col gap-1 text-sm">
          <div className="flex items-center justify-between text-gray-500">
            <span>Subtotal</span>
            <span>₹{inr(summary.subtotal)}</span>
          </div>
          {summary.catalogueSavings > 0 && (
            <div className="flex items-center justify-between text-green-600">
              <span>Catalogue savings</span>
              <span>−₹{inr(summary.catalogueSavings)}</span>
            </div>
          )}
          {summary.negotiatedSavings > 0 && (
            <div className="flex items-center justify-between text-green-600">
              <span>Negotiated deal</span>
              <span>−₹{inr(summary.negotiatedSavings)}</span>
            </div>
          )}
          <div className="flex items-center justify-between font-bold text-gray-900 pt-1">
            <span>Total ({summary.itemCount} item{summary.itemCount !== 1 ? 's' : ''})</span>
            <span>₹{inr(summary.finalTotal)}</span>
          </div>
          {savings > 0 && (
            <p className="text-[11px] text-green-600 text-right">You save ₹{inr(savings)} in total</p>
          )}
        </div>

        {Array.isArray(summary.issues) && summary.issues.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {summary.issues.map((iss, k) => (
              <p key={k} className="flex items-start gap-1"><AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {iss}</p>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={onCheckout}
          disabled={!summary.ready}
          className="btn-accent w-full py-2 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {summary.ready ? 'Proceed to Checkout' : 'Resolve issues to continue'}
        </button>
        <p className="text-[10px] text-gray-400 text-center">
          You'll review the final total on the checkout page. Payment is a demo — no real charge.
        </p>
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────
export default function AgentPanel() {
  const { agentOpen, closeAgent, agentSeed, consumeAgentSeed, openProductDetail, navigate, openAuth } = useUI();
  const { cartItems, subtotal, addToCart, removeFromCart, setQuantity, clearCart } = useCart();
  const { isAuthed, user } = useAuth();

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const sessionIdRef = useRef(getAgentSessionId());
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const welcomedRef = useRef(false);

  const cartCount = cartItems.reduce((s, i) => s + i.quantity, 0);

  // Act on a navigation hint from the agent ("take me to checkout", "show my
  // orders", "open that order"). Closes the panel and routes to the page;
  // protected destinations prompt login first.
  const handleNav = useCallback(
    (nav) => {
      if (!nav || !nav.type) return;
      closeAgent();
      if (!isAuthed) {
        openAuth('login');
        return;
      }
      if (nav.type === 'checkout') navigate('checkout');
      else if (nav.type === 'orders') navigate('orders');
      else if (nav.type === 'order') navigate('order', nav.param);
    },
    [closeAgent, isAuthed, openAuth, navigate]
  );

  // Apply validated cart actions from the agent through the existing CartContext.
  const applyCartActions = useCallback(
    (actions = []) => {
      for (const a of actions) {
        const id = Number(a.productId);
        if (a.op === 'clear') clearCart();
        else if (a.op === 'add') {
          const base = CATALOGUE.find((p) => p.id === id);
          // Pass through any agent-validated variant (colour/size) so the cart
          // line records the real chosen option (validated server-side).
          if (base) addToCart(base, a.quantity || 1, a.variant || null);
        } else if (a.op === 'remove') removeFromCart(id);
        else if (a.op === 'update') setQuantity(id, a.quantity);
      }
    },
    [addToCart, removeFromCart, setQuantity, clearCart]
  );

  const addProductById = useCallback(
    (sku, qty = 1) => {
      const base = CATALOGUE.find((p) => p.id === Number(sku));
      if (base) addToCart(base, qty);
    },
    [addToCart]
  );

  const send = useCallback(
    async (rawText) => {
      const text = String(rawText || '').trim();
      if (!text || loading) return;

      const history = messages
        .filter((m) => (m.role === 'user' || m.role === 'agent') && m.text)
        .slice(-12)
        .map((m) => ({ role: m.role === 'agent' ? 'model' : 'user', text: m.text }));

      setMessages((m) => [...m, { role: 'user', text }]);
      setInput('');
      setLoading(true);

      const cart = cartItems.map((i) => ({ productId: i.id, quantity: i.quantity }));
      try {
        const res = await sendAgentMessage({ message: text, cart, sessionId: sessionIdRef.current, history });
        if (res.sessionId) sessionIdRef.current = res.sessionId;
        if (res.cartActions?.length) applyCartActions(res.cartActions);
        setMessages((m) => [
          ...m,
          {
            role: 'agent',
            text: res.message,
            actions: res.actions || [],
            products: res.products || [],
            negotiation: res.negotiation || null,
            pending: res.pendingConfirmation || null,
            checkout: res.checkout || null,
            navigation: res.navigation || null,
            usedFallback: res.usedFallback,
          },
        ]);
      } catch (err) {
        setMessages((m) => [...m, { role: 'agent', text: err.message || 'Something went wrong.', error: true, retryText: text }]);
      } finally {
        setLoading(false);
      }
    },
    [loading, messages, cartItems, applyCartActions]
  );

  // Voice moved OUT of the chatbot into the dedicated floating VoiceAgent
  // (bottom-center of the shopping screen). The text chat below stays fully
  // functional; there is no mic control inside this panel anymore.

  // Welcome message on first open (local, no API call — snappy + quota-safe).
  useEffect(() => {
    if (!agentOpen || welcomedRef.current) return;
    welcomedRef.current = true;
    if (messages.length === 0) {
      const base = isAuthed
        ? `👋 Hi ${user?.name?.split(' ')[0] || 'there'}! I'm DealAI, your personal shopping agent. I know your cart and your order history, so I can give you tailored recommendations, build bundles, negotiate the best price, and take you to checkout or your orders — just ask.`
        : "👋 Hi! I'm DealAI, your personal shopping & negotiation agent. I can find products, compare them, check reviews, build bundles, edit your cart, and negotiate the best price on the merchant's behalf. Log in for recommendations based on your order history.";
      setMessages([{ role: 'agent', text: base, welcome: true }]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentOpen]);

  // Auto-send a seeded prompt (e.g. from "Ask DealAI about this product").
  useEffect(() => {
    if (agentOpen && agentSeed?.text) {
      send(agentSeed.text);
      consumeAgentSeed();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentOpen, agentSeed]);

  // Escape to close + scroll lock while open.
  useEffect(() => {
    if (!agentOpen) return;
    const onKey = (e) => e.key === 'Escape' && closeAgent();
    document.addEventListener('keydown', onKey);
    const t = setTimeout(() => inputRef.current?.focus(), 150);
    return () => {
      document.removeEventListener('keydown', onKey);
      clearTimeout(t);
    };
  }, [agentOpen, closeAgent]);

  // Auto-scroll to newest message.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  const resolvePending = useCallback((index, apply) => {
    setMessages((m) =>
      m.map((msg, i) => {
        if (i !== index || !msg.pending) return msg;
        if (apply) {
          const p = msg.pending;
          applyCartActions([{ op: p.op, productId: p.productId, quantity: p.quantity }]);
        }
        return { ...msg, pending: null, resolved: apply ? 'done' : 'cancelled' };
      })
    );
  }, [applyCartActions]);

  const acceptDeal = useCallback((index) => {
    setMessages((m) => m.map((msg, i) => (i === index ? { ...msg, dealAccepted: true } : msg)));
    // Lock the deal in SERVER-SIDE through the same agent pipeline (accept_deal).
    // The price is re-validated against the cart on the server and never applied
    // client-side — this button only expresses the customer's explicit consent.
    send('Deal accept karo — lock in the negotiated price.');
  }, [send]);

  const suggestions = useMemo(() => {
    return cartCount > 0
      ? ['Negotiate the best price', 'What pairs with my cart?', 'Recommend an upgrade']
      : ['Show me headphones', 'I need a backpack', 'Find running shoes'];
  }, [cartCount]);

  if (!agentOpen) return null;

  const showSuggestions = !loading && messages.filter((m) => m.role === 'user').length === 0;

  return (
    <>
      <div className="modal-overlay fixed inset-0 z-[55] bg-black/40" onClick={closeAgent} aria-hidden="true" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="DealAI shopping agent"
        className="drawer-enter fixed right-0 top-0 bottom-0 z-[56] w-full max-w-md bg-gray-50 shadow-2xl flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center">
              <Bot className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="text-sm font-bold text-gray-900 leading-tight">DealAI</p>
              <p className="text-[11px] text-gray-400 leading-tight">Shopping &amp; negotiation agent</p>
            </div>
          </div>
          <button type="button" onClick={closeAgent} aria-label="Close agent" className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Cart context strip */}
        {cartCount > 0 && (
          <div className="px-4 py-2 bg-indigo-50 border-b border-indigo-100 text-xs text-indigo-700 flex items-center gap-2 shrink-0">
            <ShoppingCart className="w-3.5 h-3.5" />
            Your cart: {cartCount} item{cartCount !== 1 ? 's' : ''} · ₹{inr(subtotal)}
          </div>
        )}

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4">
          {messages.map((m, i) =>
            m.role === 'user' ? (
              <div key={i} className="self-end max-w-[85%]">
                <div className="bg-indigo-600 text-white rounded-2xl rounded-br-sm px-3.5 py-2 text-sm">{m.text}</div>
              </div>
            ) : (
              <div key={i} className="self-start w-full max-w-[92%] flex flex-col gap-2">
                {/* Activity chips — each is a REAL completed tool step (PART 7) */}
                {Array.isArray(m.actions) && m.actions.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {m.actions.map((a, j) => (
                      <span key={j} className="inline-flex items-center gap-1 text-[10px] text-gray-500 bg-gray-100 rounded-full px-2 py-0.5">
                        <Check className="w-2.5 h-2.5 text-green-500 shrink-0" /> {a}
                      </span>
                    ))}
                  </div>
                )}

                {/* Bubble */}
                <div className={`rounded-2xl rounded-bl-sm px-3.5 py-2.5 text-sm whitespace-pre-line ${m.error ? 'bg-red-50 text-red-700 border border-red-100' : 'bg-white text-gray-800 border border-gray-100'}`}>
                  {m.error && <AlertCircle className="w-4 h-4 inline mr-1 -mt-0.5" />}
                  {m.text}
                </div>

                {/* Retry */}
                {m.error && m.retryText && (
                  <button type="button" onClick={() => send(m.retryText)} className="self-start inline-flex items-center gap-1 text-xs font-semibold text-indigo-600">
                    <RotateCcw className="w-3.5 h-3.5" /> Retry
                  </button>
                )}

                {/* Product cards */}
                {Array.isArray(m.products) && m.products.length > 0 && (
                  <div className="flex flex-col gap-2">
                    {m.products.map((p) => (
                      <ChatProductCard
                        key={p.sku}
                        product={p}
                        onView={openProductDetail}
                        onAdd={(prod) => addProductById(prod.sku)}
                        onCompare={(prod) => send(`Compare the ${prod.name} with similar options.`)}
                      />
                    ))}
                  </div>
                )}

                {/* Pending cart-change confirmation */}
                {m.pending && (
                  <ConfirmChange pending={m.pending} onConfirm={() => resolvePending(i, true)} onCancel={() => resolvePending(i, false)} />
                )}
                {m.resolved === 'done' && (
                  <p className="text-xs text-green-600 flex items-center gap-1"><Check className="w-3.5 h-3.5" /> Done — cart updated.</p>
                )}
                {m.resolved === 'cancelled' && <p className="text-xs text-gray-400">Okay, left your cart unchanged.</p>}

                {/* Negotiation card */}
                {m.negotiation && (
                  <NegotiationCard
                    deal={m.negotiation}
                    accepted={m.dealAccepted}
                    onAccept={() => acceptDeal(i)}
                    onAgain={() => send('Negotiate again for a better price')}
                  />
                )}

                {/* Checkout summary card */}
                {m.checkout && !m.checkout.empty && (
                  <CheckoutCard summary={m.checkout} onCheckout={() => handleNav({ type: 'checkout' })} />
                )}

                {/* Navigation action (e.g. "show my orders", "open that order") */}
                {m.navigation && m.navigation.type !== 'checkout' && (
                  <button
                    type="button"
                    onClick={() => handleNav(m.navigation)}
                    className="self-start inline-flex items-center gap-1.5 btn-outline py-1.5 px-3 text-xs"
                  >
                    {m.navigation.type === 'orders' ? (
                      <><Package className="w-3.5 h-3.5" /> View my orders</>
                    ) : (
                      <><Receipt className="w-3.5 h-3.5" /> View order details</>
                    )}
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )
          )}

          {/* Typing indicator */}
          {loading && (
            <div className="self-start flex items-center gap-2 bg-white border border-gray-100 rounded-2xl rounded-bl-sm px-3.5 py-3">
              <div className="dot-flashing" role="status" aria-label="DealAI is working"><span /><span /><span /></div>
              <span className="text-xs text-gray-400">DealAI is working…</span>
            </div>
          )}

          {/* Suggestion chips */}
          {showSuggestions && (
            <div className="flex flex-col gap-2 mt-1">
              <p className="text-[11px] text-gray-400 flex items-center gap-1"><Sparkles className="w-3 h-3" /> Try asking:</p>
              <div className="flex flex-wrap gap-2">
                {suggestions.map((s) => (
                  <button key={s} type="button" onClick={() => send(s)} className="text-xs bg-white border border-gray-200 rounded-full px-3 py-1.5 text-gray-700 hover:border-indigo-400 hover:text-indigo-600 transition-colors">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Persistent quick actions (PART 11) */}
        <div className="border-t border-gray-100 bg-white px-3 pt-2 pb-1 shrink-0">
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
            {QUICK_ACTIONS.filter((a) => !a.cartOnly || cartCount > 0).map((a) => (
              <button
                key={a.label}
                type="button"
                onClick={() => send(a.prompt)}
                disabled={loading}
                className="whitespace-nowrap text-[11px] font-medium bg-gray-100 hover:bg-indigo-50 hover:text-indigo-600 text-gray-600 rounded-full px-3 py-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>

        {/* Composer (text-only; voice lives in the floating VoiceAgent) */}
        <form
          onSubmit={(e) => { e.preventDefault(); send(input); }}
          className="border-t border-gray-100 bg-white px-3 py-3 flex items-center gap-2 shrink-0"
        >
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask DealAI anything…"
            className="flex-1 px-3.5 py-2.5 rounded-full border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            aria-label="Message DealAI"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            aria-label="Send"
            className="w-10 h-10 rounded-full bg-indigo-600 text-white flex items-center justify-center hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </aside>
    </>
  );
}

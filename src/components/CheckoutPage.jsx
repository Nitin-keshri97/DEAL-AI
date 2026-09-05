import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ShoppingBag, ShieldCheck, AlertCircle, Lock, Tag, Loader2, MapPin, Truck, CreditCard } from 'lucide-react';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import { previewOrder, getPaymentConfig, createRazorpayOrder, verifyRazorpayPayment, markPaymentFailed } from '../lib/api';
import { loadRazorpayScript, openRazorpayCheckout } from '../lib/razorpay';
import { getAgentSessionId } from '../lib/session';
import LoginRequired, { PageLoading } from './LoginRequired';

const inr = (n) => Number(n || 0).toLocaleString('en-IN');

export default function CheckoutPage() {
  const { cartItems, removeFromCart } = useCart();
  const { isAuthed, user, loading: authLoading } = useAuth();
  const { goToPlacedOrder, goShop } = useUI();

  const [summary, setSummary] = useState(null);
  const [missing, setMissing] = useState([]);
  const [previewing, setPreviewing] = useState(true);
  const [previewError, setPreviewError] = useState('');

  // Shipping details state
  const [address, setAddress] = useState({
    street: '123 Tech Park, MG Road',
    city: 'Bengaluru',
    state: 'Karnataka',
    pincode: '560001',
  });
  const [deliveryOption, setDeliveryOption] = useState('standard');

  const [payConfig, setPayConfig] = useState({ configured: false, keyId: '' });
  const [payConfigLoaded, setPayConfigLoaded] = useState(false);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState('');
  const [payNotice, setPayNotice] = useState('');

  const cartPayload = useMemo(
    () => cartItems.map((i) => ({ productId: i.id, quantity: i.quantity })),
    [cartItems]
  );
  const cartSig = useMemo(
    () => cartPayload.map((i) => `${i.productId}:${i.quantity}`).join('|'),
    [cartPayload]
  );
  const payloadRef = useRef(cartPayload);
  payloadRef.current = cartPayload;

  const refreshPreview = useCallback(async () => {
    if (payloadRef.current.length === 0) {
      setSummary(null);
      setMissing([]);
      setPreviewing(false);
      return;
    }
    setPreviewing(true);
    setPreviewError('');
    try {
      const { summary: s, missing: m } = await previewOrder({
        items: payloadRef.current,
        sessionId: getAgentSessionId(),
      });
      setSummary(s);
      setMissing(m);
    } catch (err) {
      setPreviewError(err?.message || 'Could not prepare your checkout.');
    } finally {
      setPreviewing(false);
    }
  }, []);

  useEffect(() => {
    if (!authLoading && isAuthed) refreshPreview();
    setPayError('');
    setPayNotice('');
  }, [authLoading, isAuthed, cartSig, refreshPreview]);

  // Load the payment configuration once (is Razorpay on + the PUBLIC key id).
  useEffect(() => {
    let unmounted = false;
    (async () => {
      try {
        const cfg = await getPaymentConfig();
        if (!unmounted) setPayConfig(cfg);
      } catch {
        if (!unmounted) setPayConfig({ configured: false, keyId: '' });
      } finally {
        if (!unmounted) setPayConfigLoaded(true);
      }
    })();
    return () => { unmounted = true; };
  }, []);

  // Razorpay flow: server creates the order for its OWN authoritative amount →
  // open Checkout → verify the signature server-side → only then it's PAID.
  const onPay = useCallback(async () => {
    if (paying) return;
    setPaying(true);
    setPayError('');
    setPayNotice('');
    try {
      // 1) Server prices the order (paise) from DB prices + any valid negotiation.
      const { orderId, razorpayOrderId, amount, currency, keyId } = await createRazorpayOrder({
        items: payloadRef.current,
        sessionId: getAgentSessionId(),
      });

      // 2) Ensure the official Razorpay Checkout script is available.
      const ready = await loadRazorpayScript();
      if (!ready || typeof window === 'undefined' || !window.Razorpay) {
        setPayError('Could not load the secure payment window. Check your connection and try again.');
        setPaying(false);
        return;
      }

      // 3) Open Checkout. The handler fires ONLY after a completed payment.
      const opened = openRazorpayCheckout({
        key: keyId,
        order_id: razorpayOrderId,
        amount,
        currency,
        name: 'DealAI',
        description: 'Secure payment (Test Mode)',
        prefill: { name: user?.name || '', email: user?.email || '' },
        theme: { color: '#4f46e5' },
        handler: async (response) => {
          // 4) Verify the signature SERVER-SIDE before trusting the payment.
          try {
            const { order } = await verifyRazorpayPayment({
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
            });
            // Clear the purchased skus only AFTER verification succeeds.
            for (const it of order?.items || []) removeFromCart(Number(it.productId));
            goToPlacedOrder(order?.id || orderId);
          } catch (err) {
            setPayError(err?.message || 'We could not verify your payment. If you were charged, please contact support.');
            setPaying(false);
          }
        },
        modal: {
          ondismiss: () => {
            // Closed without paying — record it; the order stays unpaid, no charge.
            markPaymentFailed({ razorpay_order_id: razorpayOrderId });
            setPayNotice('Payment cancelled. Your order was not placed and you were not charged.');
            setPaying(false);
          },
        },
        onFailure: () => {
          markPaymentFailed({ razorpay_order_id: razorpayOrderId });
          setPayError('Your payment did not go through. You were not charged — please try again.');
          setPaying(false);
        },
      });
      if (!opened) {
        setPayError('Could not open the payment window. Please try again.');
        setPaying(false);
      }
      // While the modal is open we keep `paying` true; the callbacks above reset it.
    } catch (err) {
      setPayError(err?.message || 'Could not start the payment. Please try again.');
      setPaying(false);
    }
  }, [paying, user, removeFromCart, goToPlacedOrder]);

  if (authLoading) return <PageLoading label="Loading checkout…" />;
  if (!isAuthed) return <LoginRequired title="Checkout" message="Log in to review and place your order." />;

  if (cartItems.length === 0) {
    return (
      <div className="max-w-md mx-auto px-4 py-20 text-center flex flex-col items-center gap-4">
        <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center text-3xl">
          🛒
        </div>
        <div>
          <h2 className="text-xl font-extrabold text-slate-900">Your cart is empty</h2>
          <p className="text-xs text-slate-500 mt-1">Add a few items and come back to check out.</p>
        </div>
        <button type="button" onClick={goShop} className="btn-accent gap-1.5 text-xs font-bold">
          <ShoppingBag className="w-4 h-4" /> Browse products
        </button>
      </div>
    );
  }

  const ready = summary && summary.ready && !summary.empty;
  const totalSavings = summary ? (summary.catalogueSavings || 0) + (summary.negotiatedSavings || 0) : 0;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      <button
        type="button"
        onClick={goShop}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 mb-4"
      >
        <ArrowLeft className="w-4 h-4" /> Continue shopping
      </button>

      <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 mb-1">Checkout</h1>
      <p className="text-xs text-slate-500 mb-6">Review address and items — totals are confirmed by the server.</p>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Address & Items */}
        <div className="lg:col-span-2 space-y-6">
          {/* Shipping Address Section */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
            <h2 className="text-sm font-extrabold text-slate-900 flex items-center gap-2 mb-4">
              <MapPin className="w-4 h-4 text-indigo-600" /> Delivery Address
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="sm:col-span-2">
                <label className="block font-semibold text-slate-600 mb-1">Full Name</label>
                <input
                  type="text"
                  readOnly
                  value={user?.name || ''}
                  className="w-full h-9 px-3 rounded-lg border border-slate-200 bg-slate-50 font-medium"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block font-semibold text-slate-600 mb-1">Street Address</label>
                <input
                  type="text"
                  value={address.street}
                  onChange={(e) => setAddress((a) => ({ ...a, street: e.target.value }))}
                  className="w-full h-9 px-3 rounded-lg border border-slate-200 focus:border-indigo-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-600 mb-1">City</label>
                <input
                  type="text"
                  value={address.city}
                  onChange={(e) => setAddress((a) => ({ ...a, city: e.target.value }))}
                  className="w-full h-9 px-3 rounded-lg border border-slate-200 focus:border-indigo-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-600 mb-1">State &amp; Pincode</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={address.state}
                    onChange={(e) => setAddress((a) => ({ ...a, state: e.target.value }))}
                    className="w-2/3 h-9 px-3 rounded-lg border border-slate-200 focus:border-indigo-600 focus:outline-none"
                  />
                  <input
                    type="text"
                    value={address.pincode}
                    onChange={(e) => setAddress((a) => ({ ...a, pincode: e.target.value }))}
                    className="w-1/3 h-9 px-3 rounded-lg border border-slate-200 focus:border-indigo-600 focus:outline-none"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Delivery Method */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
            <h2 className="text-sm font-extrabold text-slate-900 flex items-center gap-2 mb-3">
              <Truck className="w-4 h-4 text-indigo-600" /> Delivery Method
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <label
                onClick={() => setDeliveryOption('standard')}
                className={`p-3 rounded-xl border flex flex-col justify-between cursor-pointer transition-all ${
                  deliveryOption === 'standard'
                    ? 'border-indigo-600 bg-indigo-50/50'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <span className="text-xs font-bold text-slate-900">Standard Delivery</span>
                <span className="text-[11px] text-slate-500 mt-1">3–5 Business Days · Free</span>
              </label>
              <label
                onClick={() => setDeliveryOption('express')}
                className={`p-3 rounded-xl border flex flex-col justify-between cursor-pointer transition-all ${
                  deliveryOption === 'express'
                    ? 'border-indigo-600 bg-indigo-50/50'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <span className="text-xs font-bold text-slate-900">Express Delivery</span>
                <span className="text-[11px] text-slate-500 mt-1">1–2 Business Days · Free</span>
              </label>
            </div>
          </div>

          {/* Items Preview */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
            <h2 className="text-sm font-extrabold text-slate-900 mb-3">Order Items ({cartItems.length})</h2>
            <div className="divide-y divide-slate-100">
              {cartItems.map((it) => (
                <div key={it.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-3 min-w-0">
                    <img src={it.image} alt="" className="w-10 h-10 rounded-lg object-cover bg-slate-50 border border-slate-100" />
                    <div className="truncate">
                      <p className="font-bold text-slate-900 truncate">{it.name}</p>
                      <p className="text-slate-400">Qty: {it.quantity}</p>
                    </div>
                  </div>
                  <span className="font-extrabold text-slate-900 shrink-0">₹{inr(it.price * it.quantity)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Col: Authoritative Server Summary */}
        <div>
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs sticky top-20 space-y-4">
            <h2 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-indigo-600" /> Payment Summary
            </h2>

            {previewing ? (
              <div className="flex items-center justify-center gap-2 text-slate-400 py-6 text-xs">
                <Loader2 className="w-4 h-4 animate-spin" /> Verifying DB prices…
              </div>
            ) : previewError ? (
              <div className="text-center py-4">
                <p className="text-xs text-rose-600 mb-2">{previewError}</p>
                <button type="button" onClick={refreshPreview} className="btn-outline text-xs py-1 px-3">
                  Retry
                </button>
              </div>
            ) : summary ? (
              <div className="space-y-2 text-xs">
                <div className="flex justify-between text-slate-600">
                  <span>Items Subtotal</span>
                  <span>₹{inr(summary.subtotal)}</span>
                </div>
                {summary.catalogueSavings > 0 && (
                  <div className="flex justify-between text-emerald-600 font-semibold">
                    <span>Catalogue Discount</span>
                    <span>−₹{inr(summary.catalogueSavings)}</span>
                  </div>
                )}
                {summary.negotiatedSavings > 0 && (
                  <div className="flex justify-between text-indigo-600 font-bold bg-indigo-50 p-2 rounded-lg">
                    <span className="flex items-center gap-1"><Tag className="w-3.5 h-3.5" /> AI Negotiated Savings</span>
                    <span>−₹{inr(summary.negotiatedSavings)}</span>
                  </div>
                )}
                <div className="flex justify-between text-slate-600">
                  <span>Shipping</span>
                  <span className="text-emerald-600 font-bold">FREE</span>
                </div>

                <div className="flex justify-between items-baseline pt-3 border-t border-slate-100 font-extrabold text-slate-900 text-sm">
                  <span>Final Total</span>
                  <span className="text-xl text-indigo-600">₹{inr(summary.finalTotal)}</span>
                </div>
                {totalSavings > 0 && (
                  <p className="text-[11px] text-emerald-600 font-bold text-right">You save ₹{inr(totalSavings)} in total.</p>
                )}
              </div>
            ) : null}

            {missing.length > 0 && (
              <div className="flex items-start gap-2 rounded-xl bg-rose-50 border border-rose-200 p-3 text-xs text-rose-700">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  {missing.length} item{missing.length > 1 ? 's are' : ' is'} no longer available and
                  won’t be charged. Please review your cart before paying.
                </span>
              </div>
            )}

            {/* Secure payment notice (Razorpay Test Mode) */}
            <div className="flex items-start gap-2 rounded-xl bg-indigo-50 border border-indigo-200 p-3 text-xs text-indigo-800">
              <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                <strong>Secure payment by Razorpay.</strong> Your payment is verified on our server
                before the order is confirmed. Running in <strong>Test Mode</strong> — use a test card.
              </span>
            </div>

            {payNotice && (
              <p className="text-xs text-amber-700 font-semibold flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {payNotice}
              </p>
            )}
            {payError && (
              <p className="text-xs text-rose-600 font-bold flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {payError}
              </p>
            )}

            {/* Payment action — Razorpay only */}
            {payConfigLoaded && !payConfig.configured ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-center space-y-1">
                <p className="text-xs font-bold text-slate-700">Online payment is not configured</p>
                <p className="text-[11px] text-slate-500">
                  Razorpay test keys are not set on the server. Please try again later.
                </p>
              </div>
            ) : (
              <button
                type="button"
                onClick={onPay}
                disabled={!ready || previewing || paying || !payConfigLoaded || !payConfig.configured}
                className="btn-accent w-full py-3 text-xs font-bold gap-2 disabled:opacity-50"
              >
                {paying ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Opening secure payment…
                  </>
                ) : (
                  <>
                    <Lock className="w-4 h-4" />
                    {ready ? `Pay Securely · ₹${inr(summary.finalTotal)}` : 'Resolving preview…'}
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

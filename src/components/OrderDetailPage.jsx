import { useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, Clock, Truck, Package, ShieldCheck, Tag } from 'lucide-react';
import { getMyOrder } from '../lib/api';
import { useUI } from '../context/UIContext';
import StatusBadge from './StatusBadge';

const inr = (n) => Number(n || 0).toLocaleString('en-IN');

const STEPS = ['Placed', 'Confirmed', 'Processing', 'Shipped', 'Delivered'];

export default function OrderDetailPage() {
  const { viewParam: orderId, navigate, goShop } = useUI();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!orderId) return;
    let unmounted = false;
    (async () => {
      try {
        const data = await getMyOrder(orderId);
        if (!unmounted) setOrder(data);
      } catch (err) {
        if (!unmounted) setError(err?.message || 'Could not load order.');
      } finally {
        if (!unmounted) setLoading(false);
      }
    })();
    return () => { unmounted = true; };
  }, [orderId]);

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto py-20 text-center text-slate-400">
        <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-xs font-semibold">Loading invoice details…</p>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="max-w-md mx-auto py-16 text-center">
        <p className="text-sm text-rose-600 font-bold mb-4">{error || 'Order not found.'}</p>
        <button onClick={() => navigate('orders')} className="btn-outline text-xs">
          Back to My Orders
        </button>
      </div>
    );
  }

  const currentStepIdx = Math.max(0, STEPS.indexOf(order.status));

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      <button
        onClick={() => navigate('orders')}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 mb-4"
      >
        <ArrowLeft className="w-4 h-4" /> Back to My Orders
      </button>

      {/* Invoice Card */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {/* Header */}
        <div className="bg-slate-900 text-white p-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Invoice Summary</span>
            <h1 className="text-xl font-extrabold text-white mt-0.5">Order #{order.id}</h1>
            <p className="text-xs text-slate-400 mt-1">
              Placed on {new Date(order.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
          <StatusBadge status={order.status} />
        </div>

        {/* Tracking Timeline */}
        <div className="p-6 bg-slate-50 border-b border-slate-200">
          <p className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-4">Delivery Status Timeline</p>
          <div className="flex items-center justify-between relative">
            <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-1 bg-slate-200 z-0" />
            <div
              className="absolute left-0 top-1/2 -translate-y-1/2 h-1 bg-indigo-600 transition-all z-0"
              style={{ width: `${(currentStepIdx / (STEPS.length - 1)) * 100}%` }}
            />

            {STEPS.map((step, idx) => {
              const isPassed = idx <= currentStepIdx;
              return (
                <div key={step} className="flex flex-col items-center relative z-10">
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                      isPassed ? 'bg-indigo-600 text-white shadow-xs' : 'bg-slate-200 text-slate-500'
                    }`}
                  >
                    {isPassed ? <CheckCircle2 className="w-4 h-4" /> : idx + 1}
                  </div>
                  <span className={`text-[11px] font-bold mt-1.5 ${isPassed ? 'text-indigo-900' : 'text-slate-400'}`}>
                    {step}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Items Table */}
        <div className="p-6 space-y-4">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">Purchased Items</h2>
          <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
            {order.items?.map((it, idx) => (
              <div key={idx} className="p-3.5 flex items-center justify-between gap-4 text-xs bg-white">
                <div className="flex items-center gap-3 min-w-0">
                  {it.image && <img src={it.image} alt="" className="w-12 h-12 rounded-lg object-cover bg-slate-50 border border-slate-100" />}
                  <div className="truncate">
                    <p className="font-bold text-slate-900 truncate">{it.name}</p>
                    <p className="text-slate-400 text-[11px]">Brand: {it.brand || 'Standard'} · Qty: {it.quantity}</p>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-extrabold text-slate-900">₹{inr(it.lineTotal)}</p>
                  <p className="text-[10px] text-slate-400">₹{inr(it.priceAtPurchase)} each</p>
                </div>
              </div>
            ))}
          </div>

          {/* Pricing Totals Breakdown */}
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2 text-xs">
            <div className="flex justify-between text-slate-600">
              <span>Subtotal</span>
              <span>₹{inr(order.subtotal)}</span>
            </div>
            {order.catalogueSavings > 0 && (
              <div className="flex justify-between text-emerald-600 font-semibold">
                <span>Catalogue Savings</span>
                <span>−₹{inr(order.catalogueSavings)}</span>
              </div>
            )}
            {order.negotiatedDiscount > 0 && (
              <div className="flex justify-between text-indigo-600 font-bold bg-indigo-50 p-2 rounded-lg">
                <span className="flex items-center gap-1"><Tag className="w-3.5 h-3.5" /> AI Negotiated Discount</span>
                <span>−₹{inr(order.negotiatedDiscount)}</span>
              </div>
            )}
            <div className="flex justify-between items-baseline pt-2 border-t border-slate-200 font-extrabold text-slate-900 text-sm">
              <span>Total Paid</span>
              <span className="text-xl text-indigo-600">₹{inr(order.finalTotal)}</span>
            </div>
          </div>

          {/* Payment Status Info — reflects the real payment state */}
          <PaymentStatus payment={order.payment} />
        </div>
      </div>
    </div>
  );
}

/**
 * Payment status box — reflects the real state stored on the order.
 * Razorpay paid → green + payment id; pending/cancelled/failed → their own tone;
 * legacy/demo orders keep the original "Demo Completed" note.
 */
function PaymentStatus({ payment }) {
  const status = payment?.status || 'mock_pending';
  const isRazorpay = payment?.provider === 'razorpay';

  if (isRazorpay && status === 'paid') {
    return (
      <div className="flex items-center justify-between p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs font-semibold">
        <span className="flex items-center gap-1.5">
          <ShieldCheck className="w-4 h-4 text-emerald-600" /> Paid via Razorpay (Test Mode)
        </span>
        {payment?.razorpayPaymentId && (
          <span className="text-[11px] font-bold text-emerald-700 font-mono">{payment.razorpayPaymentId}</span>
        )}
      </div>
    );
  }

  if (status === 'created') {
    return (
      <div className="flex items-center justify-between p-3.5 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl text-xs font-semibold">
        <span className="flex items-center gap-1.5">
          <Clock className="w-4 h-4 text-amber-600" /> Payment pending — not yet confirmed
        </span>
      </div>
    );
  }

  if (status === 'cancelled' || status === 'failed') {
    return (
      <div className="flex items-center justify-between p-3.5 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs font-semibold">
        <span className="flex items-center gap-1.5">
          <Clock className="w-4 h-4 text-rose-500" /> Payment {status === 'failed' ? 'failed' : 'cancelled'} — order not completed
        </span>
      </div>
    );
  }

  // Legacy / demo orders (pre-Razorpay).
  return (
    <div className="flex items-center justify-between p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs font-semibold">
      <span className="flex items-center gap-1.5">
        <ShieldCheck className="w-4 h-4 text-emerald-600" /> Payment Status: Demo Completed
      </span>
      <span className="text-[11px] font-bold text-emerald-700">Method: {payment?.method || 'Demo'}</span>
    </div>
  );
}

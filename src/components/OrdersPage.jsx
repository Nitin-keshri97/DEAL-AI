import { useEffect, useState } from 'react';
import { Package, ArrowLeft, Loader2, RotateCcw, ChevronRight } from 'lucide-react';
import { getMyOrders } from '../lib/api';
import { useCart } from '../context/CartContext';
import { useUI } from '../context/UIContext';
import LoginRequired, { PageLoading } from './LoginRequired';
import StatusBadge from './StatusBadge';

const inr = (n) => Number(n || 0).toLocaleString('en-IN');

export default function OrdersPage() {
  const { navigate, goShop } = useUI();
  const { addToCart } = useCart();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let unmounted = false;
    (async () => {
      try {
        const list = await getMyOrders();
        if (!unmounted) setOrders(list || []);
      } catch (err) {
        if (!unmounted) setError(err?.message || 'Could not load your orders.');
      } finally {
        if (!unmounted) setLoading(false);
      }
    })();
    return () => { unmounted = true; };
  }, []);

  const handleReorder = (order) => {
    if (!order?.items) return;
    for (const item of order.items) {
      addToCart({
        id: item.productId,
        name: item.name,
        price: item.priceAtPurchase,
        originalPrice: item.priceAtPurchase,
        image: item.image,
        category: item.category,
      }, item.quantity);
    }
    navigate('checkout');
  };

  if (loading) return <PageLoading label="Loading orders…" />;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 min-h-[70vh]">
      <button
        onClick={goShop}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 mb-4"
      >
        <ArrowLeft className="w-4 h-4" /> Continue shopping
      </button>

      <div className="flex items-center gap-2 mb-6">
        <Package className="w-6 h-6 text-indigo-600" />
        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">My Orders</h1>
      </div>

      {error ? (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 p-4 rounded-xl text-xs font-semibold">
          {error}
        </div>
      ) : orders.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center max-w-md mx-auto shadow-xs">
          <Package className="w-12 h-12 text-slate-300 stroke-1 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-slate-900">No orders placed yet</h2>
          <p className="text-xs text-slate-500 mt-1 mb-6">
            When you place orders, their point-in-time snapshots and delivery status will show up here.
          </p>
          <button onClick={goShop} className="btn-accent px-6 text-xs font-bold">
            Browse Products
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {orders.map((o) => (
            <div key={o.id} className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs hover:border-slate-300 transition-colors">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100">
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Order #{o.id.slice(-8)}</span>
                  <p className="text-xs text-slate-500 mt-0.5">Placed on {new Date(o.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={o.status} />
                  <span className="text-base font-extrabold text-slate-900">₹{inr(o.finalTotal)}</span>
                </div>
              </div>

              {/* Item thumbnails */}
              <div className="py-3 flex items-center gap-3 overflow-x-auto no-scrollbar">
                {o.items?.map((it, idx) => (
                  <div key={idx} className="flex items-center gap-2 bg-slate-50 p-2 rounded-xl border border-slate-100 shrink-0">
                    {it.image && <img src={it.image} alt="" className="w-9 h-9 rounded-lg object-cover bg-white" />}
                    <div className="text-xs">
                      <p className="font-bold text-slate-900 max-w-[10rem] truncate">{it.name}</p>
                      <p className="text-[10px] text-slate-400">Qty: {it.quantity} · ₹{inr(it.priceAtPurchase)}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="pt-2 flex items-center justify-between border-t border-slate-100">
                <button
                  onClick={() => handleReorder(o)}
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-600 hover:text-indigo-800"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Reorder Items
                </button>

                <button
                  onClick={() => navigate('order', o.id)}
                  className="inline-flex items-center gap-1 text-xs font-bold text-slate-600 hover:text-slate-900"
                >
                  Order Details <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Heart, ShoppingCart, Trash2, ArrowLeft, Loader2 } from 'lucide-react';
import { useWishlist } from '../context/WishlistContext';
import { useCart } from '../context/CartContext';
import { useUI } from '../context/UIContext';
import { getProductDetails } from '../lib/api';

export default function WishlistPage() {
  const { wishlistSkus, removeFromWishlist } = useWishlist();
  const { addToCart } = useCart();
  const { goShop, openProductDetail } = useUI();

  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const fetched = await Promise.all(
          wishlistSkus.map(async (sku) => {
            try {
              return await getProductDetails(sku);
            } catch {
              return null;
            }
          })
        );
        if (!cancelled) setProducts(fetched.filter(Boolean));
      } catch (err) {
        console.error('Wishlist load error:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [wishlistSkus]);

  const handleMoveToCart = (p) => {
    addToCart({
      id: p.sku,
      name: p.name,
      price: p.price,
      originalPrice: p.originalPrice ?? p.price,
      image: p.image,
      category: p.category,
    });
    removeFromWishlist(p.sku);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 min-h-[70vh]">
      <button
        onClick={goShop}
        className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800 mb-4"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Continue Shopping
      </button>

      <div className="flex items-center gap-2 mb-6">
        <Heart className="w-6 h-6 text-rose-500 fill-rose-500" />
        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
          My Wishlist ({wishlistSkus.length})
        </h1>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-400">
          <Loader2 className="w-8 h-8 animate-spin mb-2 text-rose-500" />
          <p className="text-sm font-medium">Loading your wishlist items…</p>
        </div>
      ) : products.length === 0 ? (
        <div className="max-w-md mx-auto py-16 text-center bg-white rounded-2xl border border-slate-200 p-8 shadow-xs">
          <div className="w-16 h-16 rounded-full bg-rose-50 flex items-center justify-center text-rose-500 mx-auto mb-4">
            <Heart className="w-8 h-8" />
          </div>
          <h2 className="text-lg font-bold text-slate-900">Your wishlist is empty</h2>
          <p className="text-xs text-slate-500 mt-1 mb-6">
            Explore our products and tap the heart icon on items you'd like to save.
          </p>
          <button onClick={goShop} className="btn-accent px-6 text-xs font-bold">
            Start Browsing
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {products.map((p) => (
            <div key={p.sku} className="bg-white rounded-2xl border border-slate-200 p-4 flex gap-4 shadow-xs relative">
              <button
                onClick={() => openProductDetail(p.sku)}
                className="w-24 h-24 rounded-xl bg-slate-50 shrink-0 overflow-hidden"
              >
                <img src={p.image} alt={p.name} className="w-full h-full object-cover" />
              </button>

              <div className="flex flex-col flex-1 min-w-0">
                <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider">{p.category}</span>
                <h3 className="text-xs font-bold text-slate-900 truncate mt-0.5">
                  <button onClick={() => openProductDetail(p.sku)} className="hover:text-indigo-600">
                    {p.name}
                  </button>
                </h3>
                <p className="text-sm font-extrabold text-slate-900 mt-1">₹{p.price?.toLocaleString('en-IN')}</p>

                <div className="flex gap-2 mt-auto pt-2">
                  <button
                    onClick={() => handleMoveToCart(p)}
                    className="btn-accent text-[11px] py-1.5 px-3 gap-1 flex-1 font-bold"
                  >
                    <ShoppingCart className="w-3.5 h-3.5" /> Move to Cart
                  </button>
                  <button
                    onClick={() => removeFromWishlist(p.sku)}
                    className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition-colors"
                    title="Remove"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

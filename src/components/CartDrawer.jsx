import { useEffect } from 'react';
import { X, ShoppingBag, Handshake, CreditCard, Bookmark } from 'lucide-react';
import { useCart } from '../context/CartContext';
import { useWishlist } from '../context/WishlistContext';
import { useUI } from '../context/UIContext';
import { useAuth } from '../context/AuthContext';
import CartItem from './CartItem';

export default function CartDrawer({ isOpen, onClose, onDealOpen }) {
  const { cartItems, subtotal, potentialSavings, removeFromCart, clearCart } = useCart();
  const { addToWishlist } = useWishlist();
  const { navigate, openAuth } = useUI();
  const { isAuthed } = useAuth();

  const handleCheckout = () => {
    onClose();
    if (isAuthed) navigate('checkout');
    else openAuth('login');
  };

  const handleSaveForLater = (productId) => {
    addToWishlist(productId);
    removeFromCart(productId);
  };

  // Close on Escape + body scroll-lock
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-xs transition-opacity modal-overlay"
        onClick={onClose}
      />

      <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
        <div className="w-screen max-w-md bg-white shadow-2xl flex flex-col drawer-enter">
          {/* Header */}
          <div className="p-4 sm:p-6 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShoppingBag className="w-5 h-5 text-indigo-600" />
              <h2 className="text-lg font-extrabold text-slate-900">Your Cart</h2>
              <span className="text-xs bg-slate-100 text-slate-700 font-bold px-2 py-0.5 rounded-full">
                {cartItems.reduce((sum, item) => sum + item.quantity, 0)} items
              </span>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Cart Items List */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 divide-y divide-slate-100">
            {cartItems.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center text-slate-400 py-12">
                <ShoppingBag className="w-12 h-12 mb-3 stroke-1 text-slate-300" />
                <p className="text-base font-bold text-slate-700">Your cart is empty</p>
                <p className="text-xs text-slate-400 mt-1 max-w-xs">
                  Discover products from our catalogue and add them to unlock AI negotiation.
                </p>
              </div>
            ) : (
              cartItems.map((item) => (
                <div key={item.id} className="py-3.5 first:pt-0 last:pb-0">
                  <CartItem item={item} />
                  <div className="flex justify-end mt-1">
                    <button
                      onClick={() => handleSaveForLater(item.id)}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-400 hover:text-indigo-600 transition-colors"
                    >
                      <Bookmark className="w-3 h-3" /> Save for Later
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Footer & Actions */}
          {cartItems.length > 0 && (
            <div className="p-4 sm:p-6 bg-slate-50 border-t border-slate-200 space-y-3">
              <div className="space-y-1.5 text-xs text-slate-600">
                <div className="flex justify-between">
                  <span>Subtotal</span>
                  <span className="font-bold text-slate-900">₹{subtotal.toLocaleString('en-IN')}</span>
                </div>
                {potentialSavings > 0 && (
                  <div className="flex justify-between text-emerald-600 font-semibold">
                    <span>Catalogue Savings</span>
                    <span>−₹{potentialSavings.toLocaleString('en-IN')}</span>
                  </div>
                )}
              </div>

              {/* Deal AI Callout */}
              <div className="bg-indigo-50 border border-indigo-200/80 rounded-xl p-3 flex items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-bold text-indigo-900">Unlock AI Discount</p>
                  <p className="text-[11px] text-indigo-700">Make an offer on your entire cart</p>
                </div>
                <button
                  onClick={() => {
                    onClose();
                    onDealOpen();
                  }}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg flex items-center gap-1 shadow-2xs transition-colors shrink-0"
                >
                  <Handshake className="w-3.5 h-3.5" /> Make Offer
                </button>
              </div>

              {/* Checkout Button */}
              <button
                onClick={handleCheckout}
                className="w-full btn-primary py-3 text-sm font-bold flex items-center justify-center gap-2 shadow-xs"
              >
                <CreditCard className="w-4 h-4" /> Proceed to Checkout
              </button>

              <button
                onClick={clearCart}
                className="w-full text-center text-[11px] font-semibold text-slate-400 hover:text-rose-600 transition-colors"
              >
                Clear Cart
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

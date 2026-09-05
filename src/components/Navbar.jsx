import { useEffect, useRef, useState } from 'react';
import {
  ShoppingCart,
  Menu,
  X,
  Bot,
  User as UserIcon,
  Package,
  LogOut,
  ChevronDown,
  Search,
  Heart,
} from 'lucide-react';
import { useCart } from '../context/CartContext';
import { useWishlist } from '../context/WishlistContext';
import { useUI, VIEWS } from '../context/UIContext';
import { useAuth } from '../context/AuthContext';

// ─────────────────────────────────────────────────────────────────────────
// Navbar → the top action bar. Search-forward and calm: the large search /
// "ask anything" field is the focus; the AI control is a single subtle accent.
// Category & page navigation lives in the Sidebar; a hamburger opens it on
// mobile. Cart count is REAL (CartContext); user data is REAL (AuthContext).
// ─────────────────────────────────────────────────────────────────────────

export default function Navbar({ onMenu, onCartOpen }) {
  const { cartItemsCount } = useCart();
  const { wishlistSkus } = useWishlist();
  const { openAgent, openAuth, goShop, navigate, searchFor } = useUI();
  const { isAuthed, user, logout } = useAuth();

  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [searchInput, setSearchInput] = useState('');

  const userMenuRef = useRef(null);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    if (searchInput.trim()) searchFor(searchInput.trim());
  };

  useEffect(() => {
    const onDown = (e) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) setUserMenuOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setUserMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const initial = (user?.name || '?').trim().charAt(0).toUpperCase();

  const go = (view) => {
    navigate(view);
    setUserMenuOpen(false);
  };

  const doLogout = () => {
    logout();
    setUserMenuOpen(false);
    goShop();
  };

  return (
    <header className="sticky top-0 z-20 navbar-blur bg-paper/80 border-b border-line">
      <div className="px-4 sm:px-6 lg:px-8">
        <div className="flex items-center h-16 gap-2 sm:gap-3">
          {/* Mobile: menu + compact brand (desktop brand lives in the sidebar) */}
          <button
            type="button"
            onClick={onMenu}
            className="lg:hidden w-10 h-10 rounded-xl flex items-center justify-center text-ink hover:bg-mist transition-colors shrink-0"
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          <button
            onClick={goShop}
            className="lg:hidden flex items-center shrink-0"
            aria-label="DealAI home"
          >
            <span className="text-lg font-extrabold tracking-tight text-ink">
              Deal<span className="text-accent">AI</span>
            </span>
          </button>

          {/* Search / ask-anything — the calm focus of the bar */}
          <form onSubmit={handleSearchSubmit} className="flex-1 max-w-2xl">
            <div className="relative flex items-center">
              <Search className="w-[18px] h-[18px] text-faint absolute left-4 pointer-events-none" />
              <input
                type="text"
                placeholder="Search for products, brands, or ask DealAI anything…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="w-full h-11 pl-11 pr-10 rounded-full bg-mist border border-transparent focus:border-accent/40 focus:bg-paper text-sm text-ink placeholder-faint focus:outline-none focus:ring-4 focus:ring-accent/10 transition-all"
                aria-label="Search products or ask DealAI"
              />
              {searchInput && (
                <button
                  type="button"
                  onClick={() => setSearchInput('')}
                  className="absolute right-3.5 text-faint hover:text-ink"
                  aria-label="Clear search"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </form>

          {/* Right actions */}
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            {/* The single AI accent control */}
            <button
              onClick={() => openAgent()}
              aria-label="Ask DealAI"
              className="btn-ai h-10 px-3 sm:px-4 rounded-full"
            >
              <Bot className="w-[18px] h-[18px]" />
              <span className="hidden sm:inline text-sm">Ask AI</span>
            </button>

            {/* Wishlist */}
            <button
              onClick={() => navigate(VIEWS.WISHLIST)}
              aria-label={`Wishlist — ${wishlistSkus.length} items`}
              className="relative flex items-center justify-center w-10 h-10 rounded-full hover:bg-mist text-ink transition-colors"
            >
              <Heart className="w-5 h-5" />
              {wishlistSkus.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] bg-rose-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
                  {wishlistSkus.length}
                </span>
              )}
            </button>

            {/* Cart */}
            <button
              onClick={onCartOpen}
              aria-label={`Open cart — ${cartItemsCount} items`}
              className="relative flex items-center justify-center w-10 h-10 rounded-full hover:bg-mist text-ink transition-colors"
            >
              <ShoppingCart className="w-5 h-5" />
              {cartItemsCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] bg-ink text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
                  {cartItemsCount}
                </span>
              )}
            </button>

            {/* Account */}
            {isAuthed ? (
              <div className="relative" ref={userMenuRef}>
                <button
                  onClick={() => setUserMenuOpen((v) => !v)}
                  className="flex items-center gap-1.5 h-10 pl-1 pr-1 sm:pr-2 rounded-full hover:bg-mist transition-colors"
                  aria-haspopup="menu"
                  aria-expanded={userMenuOpen}
                >
                  <span
                    className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold shadow-sm"
                    style={{ backgroundColor: user?.avatarColor || '#171717' }}
                  >
                    {initial}
                  </span>
                  <span className="hidden md:inline text-sm font-semibold text-ink max-w-[7rem] truncate">
                    {user?.name}
                  </span>
                  <ChevronDown className="hidden md:inline w-4 h-4 text-faint" />
                </button>

                {userMenuOpen && (
                  <div
                    role="menu"
                    className="absolute right-0 mt-2 w-52 bg-paper rounded-2xl shadow-xl border border-line py-1 modal-content z-50"
                  >
                    <div className="px-3 py-2 border-b border-line">
                      <p className="text-sm font-semibold text-ink truncate">{user?.name}</p>
                      <p className="text-xs text-faint truncate">{user?.email}</p>
                    </div>
                    <button onClick={() => go(VIEWS.PROFILE)} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-ink hover:bg-mist">
                      <UserIcon className="w-4 h-4 text-faint" /> Profile
                    </button>
                    <button onClick={() => go(VIEWS.ORDERS)} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-ink hover:bg-mist">
                      <Package className="w-4 h-4 text-faint" /> My Orders
                    </button>
                    <button onClick={() => go(VIEWS.WISHLIST)} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-ink hover:bg-mist">
                      <Heart className="w-4 h-4 text-faint" /> Wishlist
                    </button>
                    <button onClick={doLogout} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-rose-600 hover:bg-rose-50 border-t border-line">
                      <LogOut className="w-4 h-4" /> Log out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-1.5 sm:gap-2">
                <button
                  onClick={() => openAuth('login')}
                  className="hidden sm:inline text-sm font-semibold text-ink hover:text-accent px-2 transition-colors"
                >
                  Log in
                </button>
                <button onClick={() => openAuth('signup')} className="btn-accent h-9 px-3.5 text-xs">
                  Sign Up
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

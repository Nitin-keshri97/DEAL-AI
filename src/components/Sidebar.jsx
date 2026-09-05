import {
  Home,
  Bot,
  Tag,
  LayoutGrid,
  ShoppingCart,
  Package,
  Heart,
  User,
  Settings,
  PiggyBank,
  Sparkles,
  X,
} from 'lucide-react';
import { useCart } from '../context/CartContext';
import { useWishlist } from '../context/WishlistContext';
import { useUI, VIEWS } from '../context/UIContext';

const inr = (n) => Number(n || 0).toLocaleString('en-IN');

// ─────────────────────────────────────────────────────────────────────────
// Sidebar — the persistent left rail (desktop) + off-canvas drawer (mobile).
// Pure navigation shell over the existing UIContext + Cart/Wishlist state.
// The AI Savings figure is REAL (cart potentialSavings), never hardcoded.
// ─────────────────────────────────────────────────────────────────────────

function NavButton({ icon: Icon, label, active, badge, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative flex items-center gap-3 w-full rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
        active
          ? 'bg-ink/[0.06] text-ink font-semibold'
          : 'text-muted hover:bg-mist hover:text-ink'
      }`}
    >
      {active && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-full bg-accent" aria-hidden />
      )}
      <Icon className={`w-[18px] h-[18px] shrink-0 ${active ? 'text-ink' : 'text-faint group-hover:text-ink'}`} />
      <span className="flex-1 text-left truncate">{label}</span>
      {badge > 0 && (
        <span className="ml-auto min-w-[20px] h-5 px-1.5 rounded-full bg-ink text-white text-[10px] font-bold flex items-center justify-center">
          {badge}
        </span>
      )}
    </button>
  );
}

export default function Sidebar({ mobileOpen, onClose, onCartOpen }) {
  const { cartItemsCount, potentialSavings } = useCart();
  const { wishlistSkus } = useWishlist();
  const { view, agentOpen, goShop, navigate, openAgent } = useUI();

  const close = () => onClose?.();

  // Navigate to the shop view, then smooth-scroll to a section on the home page.
  const goToSection = (id) => {
    goShop();
    requestAnimationFrame(() => {
      setTimeout(() => {
        document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 60);
    });
    close();
  };

  const act = (fn) => () => {
    fn();
    close();
  };

  const nav = [
    { icon: Home, label: 'Home', active: view === VIEWS.SHOP && !agentOpen, onClick: act(goShop) },
    { icon: Bot, label: 'AI Agent', active: agentOpen, onClick: act(() => openAgent()) },
    { icon: Tag, label: 'Deals', onClick: () => goToSection('deals') },
    { icon: LayoutGrid, label: 'Categories', onClick: () => goToSection('categories') },
    { icon: ShoppingCart, label: 'Cart', badge: cartItemsCount, onClick: act(() => onCartOpen?.()) },
    { icon: Package, label: 'Orders', active: view === VIEWS.ORDERS, onClick: act(() => navigate(VIEWS.ORDERS)) },
    { icon: Heart, label: 'Wishlist', badge: wishlistSkus.length, active: view === VIEWS.WISHLIST, onClick: act(() => navigate(VIEWS.WISHLIST)) },
    { icon: User, label: 'Account', active: view === VIEWS.PROFILE, onClick: act(() => navigate(VIEWS.PROFILE)) },
  ];

  const Content = (
    <div className="flex h-full flex-col">
      {/* Brand */}
      <div className="flex items-center justify-between px-5 h-16 shrink-0">
        <button onClick={act(goShop)} className="flex items-center gap-2.5 group" aria-label="DealAI home">
          <span className="relative w-9 h-9 rounded-xl bg-ink flex items-center justify-center shadow-sm">
            <Sparkles className="w-[18px] h-[18px] text-white" />
            <span className="absolute -inset-0.5 rounded-xl ring-1 ring-accent/30" aria-hidden />
          </span>
          <span className="flex flex-col leading-none">
            <span className="text-lg font-extrabold tracking-tight text-ink">
              Deal<span className="text-accent">AI</span>
            </span>
            <span className="text-[11px] font-medium text-faint mt-0.5">Shop Smarter.</span>
          </span>
        </button>
        <button
          type="button"
          onClick={close}
          className="lg:hidden w-9 h-9 rounded-lg flex items-center justify-center text-faint hover:bg-mist hover:text-ink"
          aria-label="Close menu"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Primary nav */}
      <nav className="flex-1 overflow-y-auto no-scrollbar px-3 py-2 space-y-0.5">
        {nav.map((item) => (
          <NavButton key={item.label} {...item} />
        ))}
      </nav>

      {/* Bottom cluster */}
      <div className="px-3 pb-4 pt-2 space-y-2.5 shrink-0">
        {/* Real AI savings from the current cart */}
        <div className="rounded-2xl bg-ink text-white p-4">
          <div className="flex items-center gap-2 text-white/70">
            <PiggyBank className="w-4 h-4" />
            <span className="text-[11px] font-semibold uppercase tracking-wider">AI Savings</span>
          </div>
          <p className="mt-1.5 text-2xl font-extrabold tracking-tight">₹{inr(potentialSavings)}</p>
          <p className="text-[11px] text-white/55 mt-0.5">
            {potentialSavings > 0 ? 'Saved in your cart' : 'Add items to start saving'}
          </p>
        </div>

        {/* Upgrade — opens the AI assistant */}
        <button
          type="button"
          onClick={act(() => openAgent())}
          className="w-full flex items-center gap-3 rounded-2xl border border-line bg-accent-soft/60 px-4 py-3 text-left hover:bg-accent-soft transition-colors"
        >
          <span className="w-8 h-8 rounded-xl bg-accent/12 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-accent" />
          </span>
          <span className="min-w-0">
            <span className="block text-xs font-bold text-ink">Upgrade to Pro</span>
            <span className="block text-[11px] text-muted truncate">Priority AI negotiation</span>
          </span>
        </button>

        <NavButton icon={Settings} label="Settings" active={false} onClick={act(() => navigate(VIEWS.PROFILE))} />
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop rail */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-64 z-30 bg-paper border-r border-line flex-col">
        {Content}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-ink/40 backdrop-blur-sm modal-overlay"
            onClick={close}
            aria-hidden
          />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[82vw] bg-paper border-r border-line flex flex-col drawer-enter-left">
            {Content}
          </aside>
        </div>
      )}
    </>
  );
}

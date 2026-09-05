import { createContext, useCallback, useContext, useState } from 'react';

// ─────────────────────────────────────────────────────────────────────────
// UIContext — coordination for DealAI views, modals, navigation, and search.
// ─────────────────────────────────────────────────────────────────────────

const UIContext = createContext(null);

export const VIEWS = Object.freeze({
  SHOP: 'shop',
  PROFILE: 'profile',
  ORDERS: 'orders',
  ORDER: 'order',
  CHECKOUT: 'checkout',
  SEARCH: 'search',
  CATEGORY: 'category',
  WISHLIST: 'wishlist',
});

export function UIProvider({ children }) {
  const [agentOpen, setAgentOpen] = useState(false);
  const [agentSeed, setAgentSeed] = useState(null);
  const [detailId, setDetailId] = useState(null);

  // Search & Category state
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');
  const [activeSubcategory, setActiveSubcategory] = useState(null);

  // Page navigation
  const [view, setView] = useState(VIEWS.SHOP);
  const [viewParam, setViewParam] = useState(null);
  const [orderJustPlaced, setOrderJustPlaced] = useState(null);

  // Auth modal
  const [authModal, setAuthModal] = useState(null);

  const openAgent = useCallback((seed = null) => {
    if (seed) setAgentSeed({ text: seed, at: Date.now() });
    setAgentOpen(true);
  }, []);
  const closeAgent = useCallback(() => setAgentOpen(false), []);
  const consumeAgentSeed = useCallback(() => setAgentSeed(null), []);

  const openProductDetail = useCallback((id) => setDetailId(id), []);
  const closeProductDetail = useCallback(() => setDetailId(null), []);

  const navigate = useCallback((nextView, param = null) => {
    setView(nextView || VIEWS.SHOP);
    setViewParam(param);
    setOrderJustPlaced(null);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const goShop = useCallback(() => navigate(VIEWS.SHOP, null), [navigate]);

  const searchFor = useCallback((query) => {
    setSearchQuery(query);
    navigate(VIEWS.SEARCH, { q: query });
  }, [navigate]);

  const selectCategory = useCallback((cat, sub = null) => {
    setActiveCategory(cat);
    setActiveSubcategory(sub);
    navigate(VIEWS.CATEGORY, { category: cat, subcategory: sub });
  }, [navigate]);

  const goToPlacedOrder = useCallback((orderId) => {
    setView(VIEWS.ORDER);
    setViewParam(orderId);
    setOrderJustPlaced(orderId);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const openAuth = useCallback((mode = 'login') => setAuthModal(mode === 'signup' ? 'signup' : 'login'), []);
  const closeAuth = useCallback(() => setAuthModal(null), []);

  return (
    <UIContext.Provider
      value={{
        agentOpen,
        agentSeed,
        openAgent,
        closeAgent,
        consumeAgentSeed,
        detailId,
        openProductDetail,
        closeProductDetail,
        // Navigation & Views
        view,
        viewParam,
        orderJustPlaced,
        navigate,
        goShop,
        goToPlacedOrder,
        // Search & Category navigation helpers
        searchQuery,
        setSearchQuery,
        searchFor,
        activeCategory,
        setActiveCategory,
        activeSubcategory,
        setActiveSubcategory,
        selectCategory,
        // Auth modal
        authModal,
        openAuth,
        closeAuth,
      }}
    >
      {children}
    </UIContext.Provider>
  );
}

export function useUI() {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error('useUI must be used within UIProvider');
  return ctx;
}

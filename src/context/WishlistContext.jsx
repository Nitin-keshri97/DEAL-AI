import { createContext, useCallback, useContext, useEffect, useReducer, useRef } from 'react';
import { getWishlist, addToWishlistApi, removeFromWishlistApi } from '../lib/api';
import { useAuth } from './AuthContext';

// ─────────────────────────────────────────────────────────────────────────
// WishlistContext — manages user's wishlist.
//
// For guests: localStorage persistence.
// For logged-in users: syncs with backend on login; live mutations update both.
// ─────────────────────────────────────────────────────────────────────────

const WishlistContext = createContext(null);
const STORAGE_KEY = 'dealai_wishlist';

function loadLocalWishlist() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch { /* ignore */ }
  return [];
}

function saveLocalWishlist(items) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch { /* ignore */ }
}

function wishlistReducer(state, action) {
  switch (action.type) {
    case 'SET': return [...action.items];
    case 'ADD': return state.includes(action.sku) ? state : [...state, action.sku];
    case 'REMOVE': return state.filter((s) => s !== action.sku);
    case 'CLEAR': return [];
    default: return state;
  }
}

export function WishlistProvider({ children }) {
  const { isAuthed, token } = useAuth();
  const [wishlistSkus, dispatch] = useReducer(wishlistReducer, undefined, loadLocalWishlist);
  const syncedForToken = useRef(null);

  // Persist to localStorage whenever state changes
  useEffect(() => {
    saveLocalWishlist(wishlistSkus);
  }, [wishlistSkus]);

  // On login: fetch server wishlist and merge with local
  useEffect(() => {
    if (!isAuthed || !token || syncedForToken.current === token) return;
    syncedForToken.current = token;
    (async () => {
      try {
        const serverSkus = await getWishlist();
        // Merge: combine server + local (server is authoritative once synced)
        const merged = [...new Set([...serverSkus, ...wishlistSkus])];
        dispatch({ type: 'SET', items: merged });
      } catch {
        // best-effort — keep local state
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthed, token]);

  // On logout: reset sync marker
  useEffect(() => {
    if (!isAuthed) syncedForToken.current = null;
  }, [isAuthed]);

  const addToWishlist = useCallback(async (sku) => {
    dispatch({ type: 'ADD', sku });
    if (isAuthed) {
      try { await addToWishlistApi(sku); } catch { /* best-effort */ }
    }
  }, [isAuthed]);

  const removeFromWishlist = useCallback(async (sku) => {
    dispatch({ type: 'REMOVE', sku });
    if (isAuthed) {
      try { await removeFromWishlistApi(sku); } catch { /* best-effort */ }
    }
  }, [isAuthed]);

  const toggleWishlist = useCallback(async (sku) => {
    if (wishlistSkus.includes(sku)) {
      await removeFromWishlist(sku);
    } else {
      await addToWishlist(sku);
    }
  }, [wishlistSkus, addToWishlist, removeFromWishlist]);

  const isInWishlist = useCallback((sku) => wishlistSkus.includes(Number(sku)), [wishlistSkus]);

  return (
    <WishlistContext.Provider value={{ wishlistSkus, addToWishlist, removeFromWishlist, toggleWishlist, isInWishlist }}>
      {children}
    </WishlistContext.Provider>
  );
}

export function useWishlist() {
  const ctx = useContext(WishlistContext);
  if (!ctx) throw new Error('useWishlist must be used within WishlistProvider');
  return ctx;
}

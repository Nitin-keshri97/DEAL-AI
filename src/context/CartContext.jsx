import { createContext, useContext, useEffect, useReducer, useRef } from 'react';

const CartContext = createContext(null);

const STORAGE_KEY = 'dealai_cart';

/** Load initial state from localStorage synchronously to avoid the
 *  write-before-read race that would wipe persisted cart data. */
function loadInitialCart() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch {
    // ignore corrupt data
  }
  return [];
}

function cartReducer(state, action) {
  switch (action.type) {
    case 'ADD_TO_CART': {
      const qty = action.quantity ?? 1;
      const variant = action.variant || null;
      const existing = state.find((item) => item.id === action.product.id);
      if (existing) {
        return state.map((item) =>
          item.id === action.product.id
            ? {
                ...item,
                quantity: item.quantity + qty,
                // A newly chosen variant (colour/size) updates the line; otherwise
                // the previous selection is kept.
                ...(variant ? { selectedVariant: variant } : {}),
              }
            : item
        );
      }
      return [...state, { ...action.product, quantity: qty, ...(variant ? { selectedVariant: variant } : {}) }];
    }

    case 'REMOVE_FROM_CART':
      return state.filter((item) => item.id !== action.productId);

    case 'INCREASE_QUANTITY':
      return state.map((item) =>
        item.id === action.productId
          ? { ...item, quantity: item.quantity + 1 }
          : item
      );

    case 'DECREASE_QUANTITY':
      return state
        .map((item) =>
          item.id === action.productId
            ? { ...item, quantity: item.quantity - 1 }
            : item
        )
        .filter((item) => item.quantity > 0);

    case 'SET_QUANTITY':
      return state
        .map((item) =>
          item.id === action.productId
            ? { ...item, quantity: Math.max(0, Math.floor(action.quantity)) }
            : item
        )
        .filter((item) => item.quantity > 0);

    case 'CLEAR_CART':
      return [];

    default:
      return state;
  }
}

export function CartProvider({ children }) {
  // Initialise from localStorage synchronously — avoids the async race
  // where the persist effect fires before hydration and wipes saved data.
  const [cartItems, dispatch] = useReducer(cartReducer, undefined, loadInitialCart);

  // Track whether this is the very first render so we don't persist the
  // initial (already-loaded) value unnecessarily on mount.
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cartItems));
    } catch {
      // ignore storage errors (e.g. private mode)
    }
  }, [cartItems]);

  // Derived values
  const cartItemsCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = cartItems.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );
  const originalTotal = cartItems.reduce(
    (sum, item) => sum + item.originalPrice * item.quantity,
    0
  );
  const potentialSavings = originalTotal - subtotal;

  function addToCart(product, quantity = 1, variant = null) {
    dispatch({ type: 'ADD_TO_CART', product, quantity, variant });
  }

  function removeFromCart(productId) {
    dispatch({ type: 'REMOVE_FROM_CART', productId });
  }

  function increaseQuantity(productId) {
    dispatch({ type: 'INCREASE_QUANTITY', productId });
  }

  function decreaseQuantity(productId) {
    dispatch({ type: 'DECREASE_QUANTITY', productId });
  }

  // Set an absolute quantity (used when the DealAI agent applies a validated
  // cart action). Removing happens automatically when quantity <= 0.
  function setQuantity(productId, quantity) {
    dispatch({ type: 'SET_QUANTITY', productId, quantity });
  }

  function clearCart() {
    dispatch({ type: 'CLEAR_CART' });
  }

  return (
    <CartContext.Provider
      value={{
        cartItems,
        cartItemsCount,
        subtotal,
        potentialSavings,
        addToCart,
        removeFromCart,
        increaseQuantity,
        decreaseQuantity,
        setQuantity,
        clearCart,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within CartProvider');
  return ctx;
}

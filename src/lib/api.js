// Frontend → DealAI backend client.
//
// The backend base URL is configurable via VITE_API_URL (set in a root .env),
// defaulting to the local Express server. The AI key and Mongo URI live ONLY
// on the server — nothing sensitive is ever referenced here.
const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:5000').replace(/\/+$/, '');

// ── Session token (Day 5 auth) ──────────────────────────────────────────────
const TOKEN_KEY = 'dealai_token';

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // ignore storage errors (e.g. private mode)
  }
}
export function clearToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore storage errors
  }
}

/** Build request headers, attaching the bearer token when we have one. */
function authHeaders(base = {}) {
  const token = getToken();
  return token ? { ...base, Authorization: `Bearer ${token}` } : { ...base };
}

/**
 * Ask DealAI to negotiate a cart.
 */
export async function negotiateDeal({ items, customerOffer, customerContext, sessionId }) {
  let res;
  try {
    res = await fetch(`${API_BASE}/api/deals/negotiate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, customerOffer, customerContext, sessionId }),
    });
  } catch {
    const err = new Error('Unable to reach DealAI. Please try again.');
    err.type = 'network';
    throw err;
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    // non-JSON response body
  }

  if (!res.ok || !data?.success) {
    const err = new Error(data?.error || 'DealAI could not process your offer.');
    err.type = res.status >= 500 || res.status === 503 ? 'server' : 'request';
    err.status = res.status;
    throw err;
  }

  return data.deal;
}

export { API_BASE };

// ── Generic JSON helpers ────────────────────────────────────────────────────
async function getJSON(path) {
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`);
  } catch {
    const err = new Error('Unable to reach DealAI. Please try again.');
    err.type = 'network';
    throw err;
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    // non-JSON body
  }
  if (!res.ok || !data?.success) {
    const err = new Error(data?.error || 'Request failed.');
    err.type = res.status >= 500 || res.status === 503 ? 'server' : 'request';
    err.status = res.status;
    throw err;
  }
  return data;
}

/** Full product catalogue (safe — no costPrice). */
export async function getProducts() {
  const data = await getJSON('/api/products');
  return data.products;
}

/** One product's detail from MongoDB. */
export async function getProductDetails(id) {
  const data = await getJSON(`/api/products/${encodeURIComponent(id)}`);
  return data.product;
}

/** Reviews + deterministic factual summary for one product. */
export async function getProductReviews(id) {
  return getJSON(`/api/products/${encodeURIComponent(id)}/reviews`);
}

/** Related products in same category. */
export async function getRelatedProducts(id) {
  const data = await getJSON(`/api/products/${encodeURIComponent(id)}/related`);
  return data.products || [];
}

/**
 * Search products with filters and pagination.
 * @param {{ q?, category?, subcategory?, brand?, minPrice?, maxPrice?, rating?, discount?, sort?, page?, limit?, inStock? }} params
 */
export async function searchProducts(params = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  });
  const data = await getJSON(`/api/products/search?${qs.toString()}`);
  return { products: data.products || [], pagination: data.pagination || {} };
}

/** All categories with subcategories from backend. */
export async function getCategories() {
  const data = await getJSON('/api/products/categories');
  return data.categories || [];
}

/**
 * Send a message to the DealAI shopping agent.
 */
export async function sendAgentMessage({ message, cart = [], sessionId, history = [] }) {
  let res;
  try {
    res = await fetch(`${API_BASE}/api/agent/chat`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ message, cart, sessionId, history }),
    });
  } catch {
    const err = new Error('Unable to reach DealAI. Please try again.');
    err.type = 'network';
    throw err;
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    // non-JSON body
  }
  if (!res.ok || !data?.success) {
    const err = new Error(data?.error || 'DealAI could not process that.');
    err.type = res.status >= 500 || res.status === 503 ? 'server' : 'request';
    err.status = res.status;
    throw err;
  }
  return data;
}

/**
 * Stream real-time agent execution events (SSE) from DealAI backend.
 */
export async function streamAgentMessage({ message, cart = [], sessionId, history = [], onEvent, signal }) {
  let res;
  try {
    res = await fetch(`${API_BASE}/api/agent/stream`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ message, cart, sessionId, history }),
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    const e = new Error('Unable to reach DealAI streaming server.');
    e.type = 'network';
    throw e;
  }

  if (!res.ok || !res.body) {
    const e = new Error('DealAI streaming request failed.');
    e.type = 'server';
    e.status = res.status;
    throw e;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';

      for (const part of parts) {
        const lines = part.split('\n');
        const dataLine = lines.find((l) => l.startsWith('data: '));
        if (!dataLine) continue;
        try {
          const event = JSON.parse(dataLine.slice(6));
          if (typeof onEvent === 'function') {
            onEvent(event);
          }
        } catch {
          // ignore malformed SSE block
        }
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw err;
  }
}

// ── Authed JSON requests ────────────────────────────────────────────────────
async function authedRequest(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: authHeaders(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    const err = new Error('Unable to reach DealAI. Please try again.');
    err.type = 'network';
    throw err;
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    // non-JSON body
  }
  if (!res.ok || !data?.success) {
    const err = new Error(data?.error || 'Request failed.');
    err.type = res.status >= 500 || res.status === 503 ? 'server' : 'request';
    err.status = res.status;
    throw err;
  }
  return data;
}

// ── Authentication ──────────────────────────────────────────────────────────
export async function signup({ name, email, password, confirmPassword }) {
  const data = await authedRequest('/api/auth/signup', {
    method: 'POST',
    body: { name, email, password, confirmPassword },
  });
  return { token: data.token, user: data.user };
}

export async function login({ email, password }) {
  const data = await authedRequest('/api/auth/login', { method: 'POST', body: { email, password } });
  return { token: data.token, user: data.user };
}

export async function getMe() {
  const data = await authedRequest('/api/auth/me');
  return data.user;
}

export async function updateProfile({ name }) {
  const data = await authedRequest('/api/auth/profile', { method: 'PUT', body: { name } });
  return data.user;
}

// ── Orders ──────────────────────────────────────────────────────────────────
export async function previewOrder({ items, sessionId }) {
  const data = await authedRequest('/api/orders/preview', { method: 'POST', body: { items, sessionId } });
  return { summary: data.summary, missing: data.missing || [] };
}

export async function placeOrder({ items, sessionId }) {
  const data = await authedRequest('/api/orders', { method: 'POST', body: { items, sessionId } });
  return { order: data.order, clearedSkus: data.clearedSkus || [] };
}

export async function getMyOrders() {
  const data = await authedRequest('/api/orders');
  return data.orders || [];
}

export async function getMyOrder(id) {
  const data = await authedRequest(`/api/orders/${encodeURIComponent(id)}`);
  return data.order;
}

// ── Payments (Razorpay Test-Mode, Day 8) ─────────────────────────────────────
/** Whether online payment is configured, plus the PUBLIC Razorpay Key ID. */
export async function getPaymentConfig() {
  const data = await getJSON('/api/payments/config');
  return { configured: Boolean(data.configured), keyId: data.keyId || '' };
}

/**
 * Create a Razorpay order for the current cart. The SERVER computes the amount
 * (paise) from DB prices + any valid negotiation — the client never sends a price.
 * @returns {{ orderId, razorpayOrderId, amount, currency, keyId, order }}
 */
export async function createRazorpayOrder({ items, sessionId }) {
  const data = await authedRequest('/api/payments/razorpay/order', {
    method: 'POST',
    body: { items, sessionId },
  });
  return {
    orderId: data.orderId,
    razorpayOrderId: data.razorpayOrderId,
    amount: data.amount,
    currency: data.currency,
    keyId: data.keyId,
    order: data.order,
  };
}

/** Verify a completed Razorpay payment server-side. Marks the order PAID only on success. */
export async function verifyRazorpayPayment({ razorpay_order_id, razorpay_payment_id, razorpay_signature }) {
  const data = await authedRequest('/api/payments/razorpay/verify', {
    method: 'POST',
    body: { razorpay_order_id, razorpay_payment_id, razorpay_signature },
  });
  return { order: data.order, alreadyProcessed: Boolean(data.alreadyProcessed), clearedSkus: data.clearedSkus || [] };
}

/** Record a dismissed/cancelled Razorpay checkout (never creates a PAID order). */
export async function markPaymentFailed({ razorpay_order_id }) {
  try {
    await authedRequest('/api/payments/razorpay/failed', { method: 'POST', body: { razorpay_order_id } });
  } catch {
    // Best-effort — a failed "mark cancelled" must never block the UI.
  }
}

// ── Best-effort per-user cart mirror ────────────────────────────────────────
export async function getMyCart() {
  const data = await authedRequest('/api/cart');
  return data.cart || [];
}

export async function saveMyCart(items) {
  const data = await authedRequest('/api/cart', { method: 'PUT', body: { items } });
  return data.cart || [];
}

// ── Wishlist ────────────────────────────────────────────────────────────────
/** Get wishlist skus for the logged-in user. */
export async function getWishlist() {
  const data = await authedRequest('/api/wishlist');
  return data.wishlist || [];
}

/** Add a product sku to the user's wishlist. Returns updated wishlist array. */
export async function addToWishlistApi(sku) {
  const data = await authedRequest(`/api/wishlist/${encodeURIComponent(sku)}`, { method: 'POST' });
  return data.wishlist || [];
}

/** Remove a product sku from the user's wishlist. Returns updated wishlist array. */
export async function removeFromWishlistApi(sku) {
  const data = await authedRequest(`/api/wishlist/${encodeURIComponent(sku)}`, { method: 'DELETE' });
  return data.wishlist || [];
}

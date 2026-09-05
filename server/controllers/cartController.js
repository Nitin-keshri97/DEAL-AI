import User from '../models/User.js';
import { isDbConnected } from '../config/db.js';

// ─────────────────────────────────────────────────────────────────────────
// cartController.js — a BEST-EFFORT per-user cart mirror (spec PART 11).
//
// The client cart (localStorage + CartContext) remains the source of truth.
// This mirror only lets a logged-in shopper reload their cart on another device.
// It stores just { productId (sku), quantity } — no prices (prices are always
// resolved from the DB at negotiate/checkout time, never trusted from here).
// These endpoints never block the UI: the client saves fire-and-forget.
// ─────────────────────────────────────────────────────────────────────────

const MAX_CART_ITEMS = 50;
const MAX_QTY = 99;

function dbGuard(res) {
  if (!isDbConnected()) {
    res.status(503).json({ success: false, error: 'Cart sync is temporarily unavailable.' });
    return false;
  }
  return true;
}

/** Normalise an incoming cart to a safe [{ productId, quantity }] list. */
function sanitizeCart(items) {
  if (!Array.isArray(items)) return [];
  const out = [];
  const seen = new Set();
  for (const it of items.slice(0, MAX_CART_ITEMS)) {
    const productId = Number(it?.productId ?? it?.id);
    const quantity = Math.floor(Number(it?.quantity));
    if (!Number.isFinite(productId) || seen.has(productId)) continue;
    if (!Number.isInteger(quantity) || quantity < 1) continue;
    seen.add(productId);
    out.push({ productId, quantity: Math.min(quantity, MAX_QTY) });
  }
  return out;
}

// GET /api/cart  (requireAuth) — the user's mirrored cart.
export async function getMyCart(req, res) {
  if (!dbGuard(res)) return;
  try {
    const user = await User.findById(req.userId).select('cart');
    if (!user) return res.status(401).json({ success: false, error: 'Session no longer valid.' });
    return res.json({ success: true, cart: sanitizeCart(user.cart) });
  } catch (err) {
    console.error('[DealAI] Get cart error:', err.message);
    return res.status(500).json({ success: false, error: 'Could not load your saved cart.' });
  }
}

// PUT /api/cart  (requireAuth)  { items: [{ productId, quantity }] }
export async function saveMyCart(req, res) {
  if (!dbGuard(res)) return;
  try {
    const cart = sanitizeCart(req.body?.items);
    const user = await User.findByIdAndUpdate(req.userId, { cart }, { new: true }).select('cart');
    if (!user) return res.status(401).json({ success: false, error: 'Session no longer valid.' });
    return res.json({ success: true, cart: sanitizeCart(user.cart) });
  } catch (err) {
    console.error('[DealAI] Save cart error:', err.message);
    return res.status(500).json({ success: false, error: 'Could not save your cart.' });
  }
}

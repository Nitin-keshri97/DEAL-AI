import Order from '../models/Order.js';
import User from '../models/User.js';
import { isDbConnected } from '../config/db.js';
import { resolveLines } from '../services/cartService.js';
import { buildCheckoutSummary } from '../services/agentTools.js';
import { peekSessionNegotiation } from '../services/agentService.js';

// ─────────────────────────────────────────────────────────────────────────
// orderController.js — create + read orders (all routes require auth).
//
// MONEY AUTHORITY (spec PARTs 8/10/19): the server is the SOLE authority for
// every price and total. We NEVER trust the client's price, discount, total or
// userId. The flow:
//   1. userId comes from the verified token (req.userId), never the body.
//   2. resolveLines() rebuilds each line from the DB — trusted prices + stock.
//   3. Any applicable negotiation is read from SERVER-SIDE session memory via
//      peekSessionNegotiation() (the client cannot inject a negotiated price).
//   4. buildCheckoutSummary() (pure, unit-tested) recomputes the authoritative
//      subtotal / savings / finalTotal; a negotiation applies only if it still
//      matches this exact cart.
//   5. The Order stores an immutable snapshot + server totals. Payment is a
//      MOCK ('mock_pending') — nothing here claims a real charge.
//
// Ownership: reads always scope by { _id, userId } so one user can never read
// another user's order (cross-user access → 404, existence not revealed).
// ─────────────────────────────────────────────────────────────────────────

const MAX_CART_ITEMS = 50;

function dbGuard(res) {
  if (!isDbConnected()) {
    res.status(503).json({ success: false, error: 'Orders are temporarily unavailable. Please try again shortly.' });
    return false;
  }
  return true;
}

// POST /api/orders  (requireAuth)
//   body: { items: [{ productId, quantity }], sessionId? }
export async function createOrder(req, res) {
  if (!dbGuard(res)) return;
  try {
    const body = req.body || {};
    const rawItems = Array.isArray(body.items) ? body.items.slice(0, MAX_CART_ITEMS) : [];
    if (rawItems.length === 0) {
      return res.status(400).json({ success: false, error: 'Your cart is empty.' });
    }

    // (2) Rebuild trusted lines from the DB — client prices are ignored entirely.
    const { lines, missing } = await resolveLines(
      rawItems.map((it) => ({ productId: it?.productId ?? it?.id, quantity: it?.quantity }))
    );
    if (missing.length > 0) {
      return res.status(400).json({ success: false, error: 'Some items are no longer available. Please review your cart.' });
    }
    if (lines.length === 0) {
      return res.status(400).json({ success: false, error: 'Your cart is empty.' });
    }

    // (3) Server-side negotiation truth (never a client-supplied price).
    const lastNegotiation = peekSessionNegotiation(body.sessionId);

    // (4) Authoritative recompute. resolveLines gives us originalPrice + inventory.
    const summary = buildCheckoutSummary(lines, { lastNegotiation });
    if (summary.empty) {
      return res.status(400).json({ success: false, error: 'Your cart is empty.' });
    }
    if (!summary.ready) {
      return res.status(409).json({ success: false, error: 'Some items need attention before checkout.', issues: summary.issues });
    }

    // (5) Immutable snapshot. Merge image (from the trusted line) into each item.
    const bySku = new Map(lines.map((l) => [Number(l.sku), l]));
    const items = summary.items.map((i) => {
      const src = bySku.get(Number(i.sku));
      return {
        productId: i.sku,
        name: i.name,
        brand: src?.brand || null,
        category: src?.category || null,
        image: src?.image || null,
        priceAtPurchase: i.price,
        quantity: i.quantity,
        lineTotal: i.lineTotal,
      };
    });

    const catalogueSavings = summary.catalogueSavings;
    const negotiatedDiscount = summary.negotiatedSavings;
    const order = await Order.create({
      userId: req.userId,
      items,
      subtotal: summary.subtotal,
      originalTotal: summary.originalTotal,
      catalogueSavings,
      negotiatedDiscount,
      finalTotal: summary.finalTotal,
      totalSavings: catalogueSavings + negotiatedDiscount,
      status: 'Placed',
      payment: { method: 'demo', status: 'mock_pending' },
    });

    // Best-effort: clear the purchased skus from the user's server cart mirror.
    const orderedSkus = items.map((i) => i.productId);
    try {
      await User.updateOne({ _id: req.userId }, { $pull: { cart: { productId: { $in: orderedSkus } } } });
    } catch {
      /* mirror is best-effort — never fail the order over it */
    }

    // Client clears these skus from its localStorage cart. Payment stays mocked.
    return res.status(201).json({ success: true, order: order.toSafeJSON(), clearedSkus: orderedSkus });
  } catch (err) {
    console.error('[DealAI] Create order error:', err.message);
    return res.status(500).json({ success: false, error: 'Could not place your order. Please try again.' });
  }
}

// POST /api/orders/preview  (requireAuth) — authoritative checkout review.
//   body: { items: [{ productId, quantity }], sessionId? }
// Recomputes the SAME server-side totals as createOrder (DB prices + any valid
// session negotiation) WITHOUT persisting anything, so the checkout page can
// show the true final total — including a negotiated discount the client never
// sees — before the customer commits. No costPrice/margin ever leaves here.
export async function previewOrder(req, res) {
  if (!dbGuard(res)) return;
  try {
    const body = req.body || {};
    const rawItems = Array.isArray(body.items) ? body.items.slice(0, MAX_CART_ITEMS) : [];

    const { lines, missing } = await resolveLines(
      rawItems.map((it) => ({ productId: it?.productId ?? it?.id, quantity: it?.quantity }))
    );

    const lastNegotiation = peekSessionNegotiation(body.sessionId);
    const summary = buildCheckoutSummary(lines, { lastNegotiation });

    return res.json({
      success: true,
      summary: { ...summary, totalSavings: summary.catalogueSavings + summary.negotiatedSavings },
      missing, // skus the client had that are no longer available
    });
  } catch (err) {
    console.error('[DealAI] Preview order error:', err.message);
    return res.status(500).json({ success: false, error: 'Could not prepare your checkout.' });
  }
}

// GET /api/orders  (requireAuth) — the current user's orders, newest first.
// Abandoned payment intents (Razorpay orders that were created but never paid,
// or were cancelled/failed) are hidden so "My Orders" shows only real orders:
// PAID Razorpay orders and legacy demo orders.
export async function listMyOrders(req, res) {
  if (!dbGuard(res)) return;
  try {
    const orders = await Order.find({
      userId: req.userId,
      'payment.status': { $nin: ['created', 'cancelled', 'failed'] },
    })
      .sort({ createdAt: -1 })
      .limit(100);
    return res.json({ success: true, orders: orders.map((o) => o.toSafeJSON()) });
  } catch (err) {
    console.error('[DealAI] List orders error:', err.message);
    return res.status(500).json({ success: false, error: 'Could not load your orders.' });
  }
}

// GET /api/orders/:id  (requireAuth) — one of the current user's orders.
export async function getMyOrder(req, res) {
  if (!dbGuard(res)) return;
  try {
    const id = req.params.id;
    if (typeof id !== 'string' || !/^[0-9a-fA-F]{24}$/.test(id)) {
      return res.status(404).json({ success: false, error: 'Order not found.' });
    }
    // Scope by userId so another user's order simply "does not exist" here.
    const order = await Order.findOne({ _id: id, userId: req.userId });
    if (!order) return res.status(404).json({ success: false, error: 'Order not found.' });
    return res.json({ success: true, order: order.toSafeJSON() });
  } catch (err) {
    console.error('[DealAI] Get order error:', err.message);
    return res.status(500).json({ success: false, error: 'Could not load that order.' });
  }
}

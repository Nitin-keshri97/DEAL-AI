import Order from '../models/Order.js';
import User from '../models/User.js';
import { isDbConnected } from '../config/db.js';
import { resolveLines } from '../services/cartService.js';
import { buildCheckoutSummary } from '../services/agentTools.js';
import { peekSessionNegotiation } from '../services/agentService.js';
import {
  isConfigured,
  getPublicKeyId,
  toPaise,
  createRazorpayOrder as createGatewayOrder,
  verifyPaymentSignature,
} from '../services/razorpayService.js';

// ─────────────────────────────────────────────────────────────────────────
// paymentController.js — real Razorpay Test-Mode payments (Day 8).
//
// MONEY AUTHORITY (unchanged from orderController): the server is the SOLE
// authority for the amount. The browser NEVER supplies the price — every amount
// is recomputed from DB prices via resolveLines → buildCheckoutSummary, and any
// negotiated discount is read from SERVER-SIDE session memory. The Razorpay order
// is created for that trusted amount (in paise), and an Order is marked PAID only
// after the payment signature is verified server-side.
//
// Flow:
//   POST /razorpay/order  → recompute total, create Razorpay order, persist a
//                           PENDING Order (payment.status:'created').
//   POST /razorpay/verify → verify signature; on success flip that Order to PAID.
//   POST /razorpay/failed → mark a dismissed/cancelled pending Order 'cancelled'.
//
// A cancelled/failed payment therefore NEVER yields a PAID order.
// ─────────────────────────────────────────────────────────────────────────

const MAX_CART_ITEMS = 50;

function dbGuard(res) {
  if (!isDbConnected()) {
    res.status(503).json({ success: false, error: 'Orders are temporarily unavailable. Please try again shortly.' });
    return false;
  }
  return true;
}

// Recompute the authoritative checkout for the current user's cart. Mirrors
// orderController.createOrder exactly, returning either an { error } to send or a
// { summary, items } snapshot ready to persist. The client's amount is ignored.
async function buildAuthoritativeCheckout(body) {
  const rawItems = Array.isArray(body.items) ? body.items.slice(0, MAX_CART_ITEMS) : [];
  if (rawItems.length === 0) {
    return { error: { status: 400, message: 'Your cart is empty.' } };
  }

  const { lines, missing } = await resolveLines(
    rawItems.map((it) => ({ productId: it?.productId ?? it?.id, quantity: it?.quantity }))
  );
  if (missing.length > 0) {
    return { error: { status: 400, message: 'Some items are no longer available. Please review your cart.' } };
  }
  if (lines.length === 0) {
    return { error: { status: 400, message: 'Your cart is empty.' } };
  }

  const lastNegotiation = peekSessionNegotiation(body.sessionId);
  const summary = buildCheckoutSummary(lines, { lastNegotiation });
  if (summary.empty) {
    return { error: { status: 400, message: 'Your cart is empty.' } };
  }
  if (!summary.ready) {
    return { error: { status: 409, message: 'Some items need attention before checkout.', issues: summary.issues } };
  }

  // Immutable snapshot — merge trusted image/brand/category from the resolved line.
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

  return { summary, items };
}

// GET /api/payments/config  (public) — is online payment on, and the PUBLIC key.
export function getConfig(_req, res) {
  return res.json({ success: true, configured: isConfigured(), keyId: getPublicKeyId() });
}

// POST /api/payments/razorpay/order  (requireAuth)
//   body: { items:[{productId,quantity}], sessionId? }
// Recomputes the trusted total, creates a Razorpay order for that amount, and
// persists a PENDING local Order. NEVER trusts any client-supplied amount.
export async function createRazorpayOrder(req, res) {
  if (!dbGuard(res)) return;
  if (!isConfigured()) {
    return res.status(503).json({ success: false, error: 'Online payment is not configured.' });
  }
  try {
    const { error, summary, items } = await buildAuthoritativeCheckout(req.body || {});
    if (error) {
      return res.status(error.status).json({ success: false, error: error.message, issues: error.issues });
    }

    const amountPaise = toPaise(summary.finalTotal);
    if (amountPaise <= 0) {
      return res.status(400).json({ success: false, error: 'Nothing to pay for.' });
    }

    // Create the gateway order for the SERVER-computed amount (in paise).
    let gateway;
    try {
      gateway = await createGatewayOrder({
        amountPaise,
        currency: 'INR',
        receipt: `rcpt_${String(req.userId).slice(-8)}_${Date.now()}`,
        notes: { userId: String(req.userId) },
      });
    } catch (gwErr) {
      return res.status(502).json({ success: false, error: gwErr.message || 'Could not start the payment.' });
    }

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
      payment: {
        method: 'razorpay',
        provider: 'razorpay',
        status: 'created', // NOT paid — verification flips this
        razorpayOrderId: gateway.id,
      },
    });

    return res.status(201).json({
      success: true,
      orderId: order.id,
      razorpayOrderId: gateway.id,
      amount: amountPaise, // paise — what Razorpay Checkout will collect
      currency: 'INR',
      keyId: getPublicKeyId(), // public
      order: order.toSafeJSON(),
    });
  } catch (err) {
    console.error('[DealAI] Create Razorpay order error:', err.message);
    return res.status(500).json({ success: false, error: 'Could not start the payment. Please try again.' });
  }
}

// POST /api/payments/razorpay/verify  (requireAuth)
//   body: { razorpay_order_id, razorpay_payment_id, razorpay_signature }
// Verifies the signature server-side and marks the OWNED pending order PAID.
// Idempotent: a second verify of an already-paid order is a no-op success.
export async function verifyPayment(req, res) {
  if (!dbGuard(res)) return;
  try {
    const body = req.body || {};
    const razorpayOrderId = body.razorpay_order_id;
    const razorpayPaymentId = body.razorpay_payment_id;
    const razorpaySignature = body.razorpay_signature;
    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      return res.status(400).json({ success: false, error: 'Missing payment confirmation details.' });
    }

    // Ownership: scope by userId so another user's order simply "does not exist".
    const order = await Order.findOne({ 'payment.razorpayOrderId': razorpayOrderId, userId: req.userId });
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found.' });
    }

    // Idempotency (req 6): never re-process an already-paid order.
    if (order.payment?.status === 'paid') {
      return res.json({ success: true, alreadyProcessed: true, order: order.toSafeJSON(), clearedSkus: [] });
    }

    // Verify the signature server-side. Invalid → the order stays UNPAID (reqs 5, 9).
    const valid = verifyPaymentSignature({
      orderId: razorpayOrderId,
      paymentId: razorpayPaymentId,
      signature: razorpaySignature,
    });
    if (!valid) {
      console.warn('[DealAI] Razorpay signature verification FAILED for order', String(order._id));
      return res.status(400).json({ success: false, error: 'Payment could not be verified.' });
    }

    // Verified → mark PAID. This is the ONLY place payment.status becomes 'paid'.
    order.payment.status = 'paid';
    order.payment.razorpayPaymentId = razorpayPaymentId;
    order.payment.razorpaySignature = razorpaySignature;
    order.payment.paidAt = new Date();
    order.status = 'Confirmed';
    await order.save();

    // Best-effort: clear the purchased skus from the user's server cart mirror.
    const clearedSkus = (order.items || []).map((i) => i.productId);
    try {
      await User.updateOne({ _id: req.userId }, { $pull: { cart: { productId: { $in: clearedSkus } } } });
    } catch {
      /* mirror is best-effort — never fail a verified payment over it */
    }

    return res.json({ success: true, order: order.toSafeJSON(), clearedSkus });
  } catch (err) {
    console.error('[DealAI] Verify payment error:', err.message);
    return res.status(500).json({ success: false, error: 'Could not verify the payment. Please contact support.' });
  }
}

// POST /api/payments/razorpay/failed  (requireAuth)
//   body: { razorpay_order_id }
// Records a dismissed/cancelled checkout on the OWNED pending order. Never
// touches an already-paid order, and never creates a PAID order (req 9).
export async function markPaymentFailed(req, res) {
  if (!dbGuard(res)) return;
  try {
    const razorpayOrderId = (req.body || {}).razorpay_order_id;
    if (!razorpayOrderId) {
      return res.status(400).json({ success: false, error: 'Missing order reference.' });
    }
    const order = await Order.findOne({ 'payment.razorpayOrderId': razorpayOrderId, userId: req.userId });
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found.' });
    }
    // Only downgrade a still-pending order; leave a paid order untouched.
    if (order.payment?.status === 'created') {
      order.payment.status = 'cancelled';
      order.status = 'Cancelled';
      await order.save();
    }
    return res.json({ success: true, order: order.toSafeJSON() });
  } catch (err) {
    console.error('[DealAI] Mark payment failed error:', err.message);
    return res.status(500).json({ success: false, error: 'Could not update the payment status.' });
  }
}

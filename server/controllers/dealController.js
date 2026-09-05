import MerchantSettings, { DEFAULT_SETTINGS } from '../models/MerchantSettings.js';
import Deal from '../models/Deal.js';
import { isDbConnected } from '../config/db.js';
import { resolveLines } from '../services/cartService.js';
import { runNegotiation } from '../services/negotiationService.js';
import { saveSessionNegotiation } from '../services/agentService.js';

async function loadSettings() {
  const doc = await MerchantSettings.findOne().lean();
  return doc || DEFAULT_SETTINGS;
}

// POST /api/deals/negotiate
export async function negotiate(req, res) {
  try {
    const { items, customerOffer, customerContext = {}, sessionId } = req.body || {};

    // ── Input validation (before any DB work) ──────────────────────────────
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'Your cart is empty.' });
    }
    const offer = Number(customerOffer);
    if (!Number.isFinite(offer) || offer <= 0) {
      return res
        .status(400)
        .json({ success: false, error: 'A valid offer amount is required.' });
    }

    // Which negotiation round is this? Optional (frontend may omit → round 1).
    // Clamped to a sane integer so it can be enforced against maxNegotiationRounds.
    const negotiationRound = Math.max(1, Math.floor(Number(req.body?.negotiationRound) || 1));

    // ── Database availability ───────────────────────────────────────────────
    if (!isDbConnected()) {
      return res.status(503).json({
        success: false,
        error: 'DealAI is not connected to its product database. Please try again shortly.',
      });
    }

    // ── Resolve products & compute the REAL cart total (never trust client) ──
    const { lines, missing } = await resolveLines(items);
    if (lines.length === 0) {
      return res
        .status(404)
        .json({ success: false, error: 'None of the cart products could be found.' });
    }
    if (missing.length) {
      return res.status(400).json({
        success: false,
        error: `Some products could not be found: ${missing.join(', ')}`,
      });
    }

    const settings = await loadSettings();

    // ── Decide via the single authoritative pipeline (Gemini → guardrails →
    //    deterministic fallback → max-rounds). Shared with the agent. ─────────
    const { ctx, deal, usedFallback, safeContext } = await runNegotiation({
      lines,
      settings,
      offer,
      negotiationRound,
      customerContext,
    });
    const { cartTotal, bundle, intent } = ctx;

    // ── Persist (best-effort; never fail the request on a write error) ───────
    Deal.create({
      cartItems: lines.map((l) => ({
        sku: l.sku,
        name: l.name,
        price: l.price,
        quantity: l.quantity,
        category: l.category,
      })),
      cartTotal,
      customerOffer: offer,
      negotiationRound,
      decision: deal.decision,
      discountPercent: deal.discountPercent,
      discountAmount: deal.discountAmount,
      finalPrice: deal.finalPrice,
      reason: deal.reason,
      aiConfidence: deal.confidence,
      engine: deal.engine,
      intent,
      bundle,
      customerContext: safeContext,
    }).catch((e) => console.warn('[DealAI] Failed to persist deal:', e.message));

    const dealCard = {
      decision: deal.decision,
      originalPrice: cartTotal,
      customerOffer: offer,
      finalPrice: deal.finalPrice,
      discountAmount: deal.discountAmount,
      discountPercent: deal.discountPercent,
      savings: deal.discountAmount,
      reason: deal.reason,
      confidence: deal.confidence,
      bundle,
      usedFallback,
    };

    if (sessionId) {
      saveSessionNegotiation(sessionId, dealCard);
    }

    // ── Safe response (NO costPrice / totalCost / margin / floor) ────────────
    return res.json({
      success: true,
      deal: dealCard,
    });
  } catch (err) {
    console.error('[DealAI] Unexpected negotiate error:', err);
    return res
      .status(500)
      .json({ success: false, error: 'Something went wrong while negotiating your deal.' });
  }
}

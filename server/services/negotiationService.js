import { buildPricingContext } from '../utils/calculations.js';
import { isAiConfigured, getAiDecision } from './aiDealService.js';
import { validateAiDeal, enforceMaxRounds } from './dealValidationService.js';
import { fallbackNegotiate } from './fallbackService.js';

// ─────────────────────────────────────────────────────────────────────────
// negotiationService.js — the single, authoritative negotiation pipeline.
//
// Extracted from dealController so BOTH the /api/deals/negotiate endpoint and
// the agent's startNegotiation tool run the exact same guardrailed flow:
//   buildPricingContext → (Gemini → validateAiDeal) or fallbackNegotiate
//                       → enforceMaxRounds
//
// The AI is never trusted for a final price: its output is always forced back
// inside the merchant floors by dealValidationService, and on ANY problem the
// deterministic fallback engine takes over. This module is the ONLY place that
// decision is made — there is no way for a caller to bypass it.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Run a full negotiation for a resolved cart.
 *
 * @param {object}   p
 * @param {Array}    p.lines           resolved cart lines (from cartService.resolveLines)
 * @param {object}   p.settings        merchant settings
 * @param {number}   p.offer           customer offer (already validated > 0)
 * @param {number}   [p.negotiationRound=1]
 * @param {object}   [p.customerContext]
 * @returns {Promise<{ctx, aiContext, deal, usedFallback, aiEnabled}>}
 */
export async function runNegotiation({ lines, settings, offer, negotiationRound = 1, customerContext = {} }) {
  const safeContext = {
    type: typeof customerContext.type === 'string' ? customerContext.type : 'guest',
    previousOrders: Math.max(0, Math.floor(Number(customerContext.previousOrders) || 0)),
  };

  const ctx = buildPricingContext(lines, settings, offer, safeContext);
  const { cartTotal, bundle, intent, distinctCount, totalUnits } = ctx;

  // Minimal, structured context for Gemini. Sends ONLY what the model needs to
  // reason and NOTHING sensitive: no cost price, no aggregate cost, no internal
  // margin/floor figures. The server enforces the real floors after the fact,
  // no matter what the model proposes.
  const aiContext = {
    currency: 'INR',
    cartTotal,
    customerOffer: offer,
    products: lines.map((l) => ({
      name: l.name,
      category: l.category,
      unitPrice: l.price,
      quantity: l.quantity,
    })),
    bundle: {
      isBundle: bundle,
      distinctProducts: distinctCount,
      totalUnits,
      bundleDiscountEnabled: settings.bundleDiscountEnabled,
    },
    merchantRules: {
      maxDiscountPercent: settings.maxDiscountPercent,
      minimumMarginPercent: settings.minimumMarginPercent,
      maxNegotiationRounds: settings.maxNegotiationRounds,
    },
    negotiationRound,
    customerContext: safeContext,
  };

  const aiEnabled = settings.aiNegotiationEnabled && isAiConfigured();
  let deal;
  let usedFallback = false;

  console.log(
    `[DealAI] negotiate cartTotal=₹${cartTotal} offer=₹${offer} round=${negotiationRound} ` +
      `bundle=${bundle} intent=${intent} aiEnabled=${aiEnabled}`
  );

  if (offer >= cartTotal) {
    // Offer meets/exceeds sticker — deterministic accept, no AI needed.
    deal = fallbackNegotiate(ctx, offer);
  } else if (aiEnabled) {
    try {
      const raw = await getAiDecision(aiContext);
      const result = validateAiDeal(raw, ctx, offer);
      if (result.valid) {
        deal = result.deal;
        console.log(
          `[DealAI] Gemini decision=${deal.decision} finalPrice=₹${deal.finalPrice} ` +
            `discount=${deal.discountPercent}% confidence=${deal.confidence}` +
            (deal.adjusted ? ` (guardrails adjusted: ${deal.notes.join('; ')})` : '')
        );
      } else {
        console.warn('[DealAI] Gemini output rejected by validator:', result.error, '→ fallback');
        deal = fallbackNegotiate(ctx, offer);
        usedFallback = true;
      }
    } catch (err) {
      console.warn('[DealAI] Gemini call failed, using deterministic fallback:', err.message);
      deal = fallbackNegotiate(ctx, offer);
      usedFallback = true;
    }
  } else {
    // AI disabled/unconfigured — the deterministic rules engine is the path.
    deal = fallbackNegotiate(ctx, offer);
  }

  // ── Guardrail: enforce the merchant's maximum negotiation rounds ───────────
  // Applied to the FINAL deal regardless of engine. Beyond the cap, no more
  // counters: finalise as ACCEPT (if the offer clears the floor) or REJECT.
  const decisionBeforeRounds = deal.decision;
  deal = enforceMaxRounds(deal, ctx, {
    customerOffer: offer,
    negotiationRound,
    maxNegotiationRounds: settings.maxNegotiationRounds,
  });
  if (deal.decision !== decisionBeforeRounds) {
    console.log(
      `[DealAI] max rounds (${settings.maxNegotiationRounds}) exceeded at round ` +
        `${negotiationRound} — ${decisionBeforeRounds} → ${deal.decision}`
    );
  }

  return { ctx, aiContext, deal, usedFallback, aiEnabled, safeContext };
}

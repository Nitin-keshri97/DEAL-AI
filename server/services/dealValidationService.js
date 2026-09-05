import { toRupees, round2 } from '../utils/calculations.js';

// ─────────────────────────────────────────────────────────────────────────
// Server-side validation. NEVER trust AI output blindly.
//
// Takes the raw decision object returned by the AI (Gemini) and forces it
// inside the merchant guardrails, re-deriving every money figure from the
// trusted server pricing context. If the AI output is structurally unusable it
// returns { valid: false } and the caller MUST use the deterministic fallback.
//
// Gemini schema (primary):   { decision, counterPrice: number|null, reason: string, confidence }
// Legacy schema (tolerated): { decision, finalPrice|discountPercent, reason: string[], confidence }
// ─────────────────────────────────────────────────────────────────────────

const DECISIONS = ['ACCEPT', 'COUNTER_OFFER', 'REJECT'];

export function validateAiDeal(raw, ctx, customerOffer) {
  const { cartTotal, minimumAllowedPrice, discountPossible, maxDiscountPercent } = ctx;

  // 1. Validate the response is an object.
  if (!raw || typeof raw !== 'object') {
    return { valid: false, error: 'AI response was not an object' };
  }

  // 2. Validate the decision.
  let decision = raw.decision;
  if (!DECISIONS.includes(decision)) {
    return { valid: false, error: `invalid decision: ${decision}` };
  }

  const floor = discountPossible ? minimumAllowedPrice : cartTotal;

  // 3. Validate / resolve the proposed price.
  //    Prefer Gemini's `counterPrice`; tolerate legacy `finalPrice` /
  //    `discountPercent`. A `null` price is legitimate for ACCEPT / REJECT.
  let price = NaN;
  let fieldMalformed = false;
  const consider = (v) => {
    if (v === undefined || v === null) return; // null → "no explicit price"
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) price = n;
    else fieldMalformed = true; // present but not a valid positive number
  };
  if ('counterPrice' in raw) consider(raw.counterPrice);
  if (!Number.isFinite(price) && 'finalPrice' in raw) consider(raw.finalPrice);
  if (!Number.isFinite(price)) {
    const dp = Number(raw.discountPercent);
    if (Number.isFinite(dp) && dp >= 0 && dp <= 100) price = cartTotal * (1 - dp / 100);
  }

  // A present-but-garbage price field is malformed → discard AI output.
  if (fieldMalformed) return { valid: false, error: 'malformed price field' };
  // A COUNTER_OFFER with no usable price is malformed.
  if (decision === 'COUNTER_OFFER' && !Number.isFinite(price)) {
    return { valid: false, error: 'COUNTER_OFFER requires a numeric counterPrice' };
  }
  // ACCEPT / REJECT with a null price → derive from decision semantics.
  if (!Number.isFinite(price)) price = decision === 'ACCEPT' ? customerOffer : floor;
  price = toRupees(price);

  const notes = [];

  // 4 + 5. Enforce MAX DISCOUNT and MIN MARGIN via the binding floor.
  //        `floor` already folds in whichever rule binds (see calculations.js).
  if (price > cartTotal) {
    price = cartTotal;
    notes.push('capped at cart total');
  }
  if (price < floor) {
    price = floor;
    notes.push('raised to minimum allowed price');
  }

  // ── Decision / price consistency + safety ───────────────────────────────
  if (!discountPossible) {
    // No discount is possible at all → the only honest outcome is REJECT.
    decision = 'REJECT';
    price = cartTotal;
  } else if (decision === 'ACCEPT') {
    // Accepting means the customer pays their own offer — which must clear the floor.
    if (customerOffer < floor) {
      decision = 'COUNTER_OFFER';
      price = floor;
      notes.push('cannot accept an offer below the floor');
    } else {
      price = Math.min(customerOffer, cartTotal);
    }
  } else if (decision === 'COUNTER_OFFER') {
    // A counter must be strictly above the customer's offer; otherwise just accept it.
    if (price <= customerOffer) {
      if (customerOffer >= floor) {
        decision = 'ACCEPT';
        price = Math.min(customerOffer, cartTotal);
      } else {
        price = floor; // floor is above the offer here, so it's a real counter
      }
    }
  } else {
    // REJECT → show the best price we could actually honour.
    price = floor;
  }

  const discountAmount = toRupees(cartTotal - price);
  const discountPercent = round2((discountAmount / cartTotal) * 100);

  // 7. Reject anything still out of bounds → caller falls back.
  if (discountPercent < -1e-6 || discountPercent > maxDiscountPercent + 1e-6) {
    return { valid: false, error: 'discount out of bounds after normalisation' };
  }
  if (price < 0 || price > cartTotal) {
    return { valid: false, error: 'price out of bounds after normalisation' };
  }

  // ── Sanitise reason (accepts a string OR an array) + confidence ──────────
  let reason;
  if (Array.isArray(raw.reason)) {
    reason = raw.reason.filter((r) => typeof r === 'string' && r.trim()).map((r) => r.trim());
  } else if (typeof raw.reason === 'string' && raw.reason.trim()) {
    reason = [raw.reason.trim()];
  } else {
    reason = [];
  }
  reason = reason.slice(0, 5);
  if (reason.length === 0) reason = ['Offer evaluated against merchant pricing rules'];

  let confidence = Number(raw.confidence);
  if (!Number.isFinite(confidence)) confidence = 75;
  confidence = Math.max(0, Math.min(100, Math.round(confidence)));

  return {
    valid: true,
    deal: {
      decision,
      finalPrice: price,
      discountAmount,
      discountPercent,
      reason,
      confidence,
      engine: 'ai',
      adjusted: notes.length > 0,
      notes,
    },
  };
}

/**
 * 6. Enforce the merchant's MAXIMUM NEGOTIATION ROUNDS.
 *
 * Once the round count exceeds the cap, no further COUNTER_OFFER is permitted:
 * the deal is finalised as ACCEPT (if the customer's offer already clears the
 * floor) or REJECT. Applied to the FINAL deal regardless of which engine
 * (AI or deterministic fallback) produced it. Money figures are re-derived.
 */
export function enforceMaxRounds(deal, ctx, { customerOffer, negotiationRound, maxNegotiationRounds }) {
  const round = Number(negotiationRound);
  const max = Number(maxNegotiationRounds);
  if (!Number.isFinite(round) || !Number.isFinite(max) || round <= max) return deal;
  if (deal.decision !== 'COUNTER_OFFER') return deal; // already a terminal decision

  const { cartTotal, minimumAllowedPrice, discountPossible } = ctx;
  const floor = discountPossible ? minimumAllowedPrice : cartTotal;

  let decision;
  let finalPrice;
  if (customerOffer >= floor) {
    decision = 'ACCEPT';
    finalPrice = Math.min(toRupees(customerOffer), cartTotal);
  } else {
    decision = 'REJECT';
    finalPrice = floor;
  }

  const discountAmount = toRupees(cartTotal - finalPrice);
  const discountPercent = round2((discountAmount / cartTotal) * 100);
  const reason = [
    ...(Array.isArray(deal.reason) ? deal.reason : []),
    'Maximum negotiation rounds reached — this is the final price',
  ].slice(0, 5);

  return { ...deal, decision, finalPrice, discountAmount, discountPercent, reason, roundsExhausted: true };
}

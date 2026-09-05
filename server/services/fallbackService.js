import { toRupees, round2 } from '../utils/calculations.js';

// ─────────────────────────────────────────────────────────────────────────
// Deterministic fallback negotiator.
//
// Used whenever the AI is unavailable, misconfigured, times out, or returns
// something we can't safely use. It is guaranteed to obey every merchant rule
// because it is built directly from the pricing floors in `ctx`.
// ─────────────────────────────────────────────────────────────────────────

const ACCEPT_RATIO = 0.95; // offers within 5% of cart value are accepted as-is
const VERY_LOW_RATIO = 0.7; // offers below 70% of the floor are rejected outright

export function fallbackNegotiate(ctx, customerOffer) {
  const { cartTotal, minimumAllowedPrice, discountPossible, bundle, inventoryStatus } = ctx;
  const floor = discountPossible ? minimumAllowedPrice : cartTotal;

  let decision;
  let finalPrice;
  let reason = [];

  if (customerOffer >= cartTotal) {
    // Offer at or above the sticker — accept, never overcharge.
    decision = 'ACCEPT';
    finalPrice = cartTotal;
    reason = ['Your offer meets the cart value', 'No further discount required'];
  } else if (!discountPossible) {
    // Even a full-price sale barely clears the margin floor — no room to move.
    decision = 'REJECT';
    finalPrice = cartTotal;
    reason = [
      'This cart is already at its best available price',
      'A further discount would breach merchant pricing rules',
    ];
  } else if (customerOffer >= floor) {
    // Offer clears the binding floor.
    if (customerOffer >= cartTotal * ACCEPT_RATIO) {
      decision = 'ACCEPT';
      finalPrice = customerOffer;
      reason = ['Your offer is close to the cart value', 'Offer stays within merchant pricing rules'];
    } else {
      // Meet the customer partway, never below the floor.
      const midpoint = toRupees((customerOffer + cartTotal) / 2);
      finalPrice = Math.min(cartTotal, Math.max(floor, midpoint));
      if (finalPrice <= customerOffer) {
        decision = 'ACCEPT';
        finalPrice = customerOffer;
        reason = ['Your offer stays within merchant pricing rules'];
      } else {
        decision = 'COUNTER_OFFER';
        reason = ['We met your offer partway', 'Final price stays within merchant pricing rules'];
      }
    }
  } else {
    // Below the floor.
    if (customerOffer < floor * VERY_LOW_RATIO) {
      decision = 'REJECT';
      finalPrice = floor; // best available price to show the customer
      reason = ['Your offer is outside the available pricing range', 'Best available price shown'];
    } else {
      decision = 'COUNTER_OFFER';
      finalPrice = floor;
      reason = [
        'Your offer exceeds the permitted discount boundary',
        'Countered at the best price we can offer',
      ];
    }
  }

  // Positive conversion signals (informational, never override a floor).
  if (bundle) reason.push('Bundle purchase across multiple products');
  if (inventoryStatus === 'HEALTHY') reason.push('Inventory is healthy');

  finalPrice = toRupees(finalPrice);
  const discountAmount = toRupees(cartTotal - finalPrice);
  const discountPercent = round2((discountAmount / cartTotal) * 100);
  const confidence = decision === 'ACCEPT' ? 82 : decision === 'COUNTER_OFFER' ? 74 : 60;

  return {
    decision,
    finalPrice,
    discountAmount,
    discountPercent,
    reason: reason.slice(0, 5),
    confidence,
    engine: 'fallback',
  };
}

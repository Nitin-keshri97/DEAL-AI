// ─────────────────────────────────────────────────────────────────────────
// calculations.js — Pure, deterministic pricing math for DealAI.
//
// Everything here is side-effect free and DB-agnostic so it can be unit
// tested in isolation (see server/test/negotiation.test.js). This is the
// single source of truth for the merchant pricing floors that the AI is
// NEVER allowed to violate.
// ─────────────────────────────────────────────────────────────────────────

/** Round to 2 decimals (money). */
export function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/** Round to whole rupees. */
export function toRupees(n) {
  return Math.round(Number(n));
}

/**
 * Classify purchase intent from the offer ratio, bundle size and loyalty.
 * Deliberately avoids any sensitive personal attribute — offer behaviour only.
 */
export function classifyIntent({ cartTotal, customerOffer, distinctCount, customerContext }) {
  if (!cartTotal || cartTotal <= 0) return 'LOW';
  const ratio = customerOffer / cartTotal;

  let level;
  if (ratio >= 0.85) level = 'HIGH';
  else if (ratio >= 0.65) level = 'MEDIUM';
  else level = 'LOW';

  // Positive signals nudge intent up one notch (never past HIGH).
  const isBundle = distinctCount >= 2;
  const loyal =
    customerContext &&
    (customerContext.type === 'returning' || Number(customerContext.previousOrders) >= 3);

  if ((isBundle || loyal) && level === 'LOW') level = 'MEDIUM';
  else if ((isBundle && loyal) && level === 'MEDIUM') level = 'HIGH';

  return level;
}

/** Coarse inventory health from the lowest-stock item in the cart. */
export function inventoryStatusFrom(minInventory) {
  if (minInventory > 50) return 'HEALTHY';
  if (minInventory > 15) return 'MODERATE';
  return 'LOW';
}

/**
 * Build the full business/pricing context for a resolved cart.
 *
 * @param {Array<{name,category,price,costPrice,inventory,quantity}>} lines
 * @param {object} settings merchant settings (maxDiscountPercent, minimumMarginPercent, ...)
 * @param {number} customerOffer
 * @param {object} customerContext { type, previousOrders }
 */
export function buildPricingContext(lines, settings, customerOffer, customerContext = {}) {
  const cartTotal = toRupees(lines.reduce((s, l) => s + l.price * l.quantity, 0));
  const totalCost = toRupees(lines.reduce((s, l) => s + l.costPrice * l.quantity, 0));

  const maxDiscountPercent = Number(settings.maxDiscountPercent) || 0;
  const minimumMarginPercent = Number(settings.minimumMarginPercent) || 0;

  // Floor 1 — merchant max-discount rule.
  const discountFloorPrice = round2(cartTotal * (1 - maxDiscountPercent / 100));

  // Floor 2 — merchant minimum-margin rule:  price >= cost / (1 - margin%).
  // (Guard against a nonsensical margin of >= 100%.)
  const marginDivisor = 1 - Math.min(minimumMarginPercent, 99.9999) / 100;
  const marginFloorPrice = marginDivisor > 0 ? round2(totalCost / marginDivisor) : cartTotal;

  // The binding floor is the STRICTER (higher) of the two.
  const rawFloor = Math.max(discountFloorPrice, marginFloorPrice);

  // If the floor meets or exceeds the sticker price, no discount is possible;
  // the best available price is then the full cart total.
  const discountPossible = rawFloor < cartTotal;
  const minimumAllowedPrice = toRupees(discountPossible ? rawFloor : cartTotal);

  const maxDiscountAmount = toRupees(cartTotal - discountFloorPrice);

  const distinctCount = lines.length;
  const totalUnits = lines.reduce((s, l) => s + l.quantity, 0);
  const bundle = distinctCount >= 2;
  const minInventory = lines.reduce((m, l) => Math.min(m, Number(l.inventory) || 0), Infinity);
  const inventoryStatus = inventoryStatusFrom(minInventory === Infinity ? 0 : minInventory);
  const intent = classifyIntent({ cartTotal, customerOffer, distinctCount, customerContext });

  return {
    cartTotal,
    totalCost,
    maxDiscountPercent,
    minimumMarginPercent,
    discountFloorPrice: toRupees(discountFloorPrice),
    marginFloorPrice: toRupees(marginFloorPrice),
    minimumAllowedPrice,
    maxDiscountAmount,
    discountPossible,
    bundle,
    distinctCount,
    totalUnits,
    inventoryStatus,
    intent,
  };
}

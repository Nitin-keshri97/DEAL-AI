// Standalone engine tests — no database required.
// Run with:  node server/test/negotiation.test.js
//
// Verifies the pricing math, the deterministic fallback, and (critically) that
// the server-side validator can never let the AI breach merchant guardrails.

import { buildPricingContext } from '../utils/calculations.js';
import { validateAiDeal } from '../services/dealValidationService.js';
import { fallbackNegotiate } from '../services/fallbackService.js';

const SETTINGS = {
  maxDiscountPercent: 10,
  minimumMarginPercent: 15,
  bundleDiscountEnabled: true,
  aiNegotiationEnabled: true,
  maxNegotiationRounds: 3,
};

// Sneakers (2000, cost 1400) + T-Shirt (800, cost 350) → total 2800, cost 1750.
const CART = [
  { name: 'Premium Sneakers', category: 'Footwear', price: 2000, costPrice: 1400, inventory: 80, quantity: 1 },
  { name: 'Oversized T-Shirt', category: 'Clothing', price: 800, costPrice: 350, inventory: 200, quantity: 1 },
];

const GUEST = { type: 'guest', previousOrders: 0 };
const ctxAt = (offer, cart = CART) => buildPricingContext(cart, SETTINGS, offer, GUEST);

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log('  ✓', name);
    passed++;
  } catch (e) {
    console.error('  ✗', name, '\n      ', e.message);
    failed++;
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

console.log('\nDealAI negotiation engine tests\n');

// ── Pricing context math ────────────────────────────────────────────────────
test('context: totals, floors and bundle are computed correctly', () => {
  const c = ctxAt(2500);
  assert(c.cartTotal === 2800, `cartTotal ${c.cartTotal}`);
  assert(c.totalCost === 1750, `totalCost ${c.totalCost}`);
  assert(c.minimumAllowedPrice === 2520, `minAllowed ${c.minimumAllowedPrice}`); // max-discount floor binds
  assert(c.discountPossible === true, 'discountPossible');
  assert(c.bundle === true, 'bundle');
});

// ── TEST 1: 2800 / offer 2700 → ACCEPT (or safe counter), never > max discount ─
test('TEST 1: offer 2700 → fallback ACCEPTs at 2700 within max discount', () => {
  const d = fallbackNegotiate(ctxAt(2700), 2700);
  assert(d.decision === 'ACCEPT', `decision ${d.decision}`);
  assert(d.finalPrice === 2700, `finalPrice ${d.finalPrice}`);
  assert(d.discountPercent <= 10 + 1e-9, `discount ${d.discountPercent}`);
});
test('TEST 1: AI ACCEPT at 2700 passes validation unchanged', () => {
  const r = validateAiDeal({ decision: 'ACCEPT', finalPrice: 2700, reason: ['close offer'], confidence: 90 }, ctxAt(2700), 2700);
  assert(r.valid, 'valid');
  assert(r.deal.decision === 'ACCEPT' && r.deal.finalPrice === 2700, `got ${JSON.stringify(r.deal)}`);
});

// ── TEST 2: 2800 / offer 2500, max 10% → final >= 2520 ────────────────────────
test('TEST 2: offer 2500 → fallback COUNTERs at the 2520 floor', () => {
  const d = fallbackNegotiate(ctxAt(2500), 2500);
  assert(d.decision === 'COUNTER_OFFER', `decision ${d.decision}`);
  assert(d.finalPrice >= 2520, `finalPrice ${d.finalPrice}`);
  assert(d.discountPercent <= 10 + 1e-9, `discount ${d.discountPercent}`);
});
test('TEST 2: AI trying to ACCEPT 2500 (below floor) is corrected to a >=2520 counter', () => {
  const r = validateAiDeal({ decision: 'ACCEPT', finalPrice: 2500, reason: ['x'], confidence: 88 }, ctxAt(2500), 2500);
  assert(r.valid, 'valid');
  assert(r.deal.decision === 'COUNTER_OFFER', `decision ${r.deal.decision}`);
  assert(r.deal.finalPrice >= 2520, `finalPrice ${r.deal.finalPrice}`);
});

// ── TEST 3: 2800 / offer 1000 → never accept below floor ──────────────────────
test('TEST 3: offer 1000 → fallback never sells below 2520', () => {
  const d = fallbackNegotiate(ctxAt(1000), 1000);
  assert(d.decision !== 'ACCEPT', `decision ${d.decision}`);
  assert(d.finalPrice >= 2520, `finalPrice ${d.finalPrice}`);
});
test('TEST 3: dangerous AI (accept 500 @ 82% off) is clamped to a safe >=2520 deal', () => {
  const r = validateAiDeal({ decision: 'ACCEPT', finalPrice: 500, discountPercent: 82, reason: ['bad'], confidence: 99 }, ctxAt(1000), 1000);
  assert(r.valid, 'valid');
  assert(r.deal.decision === 'COUNTER_OFFER', `decision ${r.deal.decision}`);
  assert(r.deal.finalPrice >= 2520, `finalPrice ${r.deal.finalPrice}`);
  assert(r.deal.discountPercent <= 10 + 1e-9, `discount ${r.deal.discountPercent}`);
});

// ── TEST 5: invalid AI output is rejected by the validator ────────────────────
test('TEST 5: invalid AI JSON/shape is rejected (caller will fall back)', () => {
  assert(validateAiDeal(null, ctxAt(2500), 2500).valid === false, 'null');
  assert(validateAiDeal({ decision: 'MAYBE' }, ctxAt(2500), 2500).valid === false, 'bad decision');
  assert(validateAiDeal({ decision: 'ACCEPT', finalPrice: 'abc' }, ctxAt(2500), 2500).valid === false, 'NaN price');
});

// ── TEST 8: offer >= cart total is handled gracefully ─────────────────────────
test('TEST 8: offer 3000 (>= 2800) → ACCEPT at cart total, zero discount', () => {
  const d = fallbackNegotiate(ctxAt(3000), 3000);
  assert(d.decision === 'ACCEPT', `decision ${d.decision}`);
  assert(d.finalPrice === 2800, `finalPrice ${d.finalPrice}`);
  assert(d.discountAmount === 0, `discountAmount ${d.discountAmount}`);
});

// ── No-discount cart (base price already below the margin requirement) ────────
test('No-discount cart: margin floor above sticker → REJECT at full price', () => {
  const CART2 = [{ name: 'Thin Widget', category: 'x', price: 1000, costPrice: 900, inventory: 100, quantity: 1 }];
  const c = buildPricingContext(CART2, SETTINGS, 800, GUEST);
  assert(c.discountPossible === false, 'discountPossible should be false');
  assert(c.minimumAllowedPrice === 1000, `minAllowed ${c.minimumAllowedPrice}`);
  const d = fallbackNegotiate(c, 800);
  assert(d.decision === 'REJECT', `decision ${d.decision}`);
  assert(d.finalPrice === 1000, `finalPrice ${d.finalPrice}`);
  const r = validateAiDeal({ decision: 'ACCEPT', finalPrice: 850 }, c, 800);
  assert(r.valid && r.deal.decision === 'REJECT' && r.deal.finalPrice === 1000, `got ${JSON.stringify(r.deal)}`);
});

// ── Property sweep: no offer, no adversarial AI, can ever breach guardrails ────
test('PROPERTY: across all offers, neither fallback nor a malicious AI can breach the floor/max-discount', () => {
  for (let offer = 100; offer < 2800; offer += 100) {
    const c = ctxAt(offer);
    const floor = c.minimumAllowedPrice;

    const fb = fallbackNegotiate(c, offer);
    assert(fb.finalPrice >= floor, `fallback ${offer}: price ${fb.finalPrice} < floor ${floor}`);
    assert(fb.finalPrice <= c.cartTotal, `fallback ${offer}: price > cartTotal`);
    assert(fb.discountPercent <= 10 + 1e-9, `fallback ${offer}: discount ${fb.discountPercent}`);

    // Malicious AI trying to give the store away.
    const r = validateAiDeal({ decision: 'ACCEPT', finalPrice: 1, discountPercent: 99, confidence: 100 }, c, offer);
    if (r.valid) {
      assert(r.deal.finalPrice >= floor, `ai ${offer}: price ${r.deal.finalPrice} < floor ${floor}`);
      assert(r.deal.finalPrice <= c.cartTotal, `ai ${offer}: price > cartTotal`);
      assert(r.deal.discountPercent <= 10 + 1e-9, `ai ${offer}: discount ${r.deal.discountPercent}`);
    }
  }
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);

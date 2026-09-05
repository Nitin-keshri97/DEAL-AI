// Gemini integration tests — no network, no database, no real API key.
// Run with:  node server/test/gemini.test.js
//
// global.fetch is stubbed to simulate Gemini responses so we can exercise the
// real parsing + the real server-side guardrails deterministically. A dummy
// key is used so isAiConfigured() is satisfied; no secret is ever touched.

process.env.AI_API_KEY = 'test-dummy-key-not-a-real-secret';
process.env.AI_MODEL = 'gemini-2.0-flash';
process.env.AI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

import { buildPricingContext } from '../utils/calculations.js';
import { validateAiDeal, enforceMaxRounds } from '../services/dealValidationService.js';
import { fallbackNegotiate } from '../services/fallbackService.js';
import { getAiDecision, parseDecision } from '../services/aiDealService.js';

// ── Fixtures ────────────────────────────────────────────────────────────────
const SETTINGS = {
  maxDiscountPercent: 10,
  minimumMarginPercent: 15,
  bundleDiscountEnabled: true,
  aiNegotiationEnabled: true,
  maxNegotiationRounds: 3,
};
// Sneakers (2000, cost 1400) + T-Shirt (800, cost 350) → total 2800, floor 2520.
const CART = [
  { name: 'Premium Sneakers', category: 'Footwear', price: 2000, costPrice: 1400, inventory: 80, quantity: 1 },
  { name: 'Oversized T-Shirt', category: 'Clothing', price: 800, costPrice: 350, inventory: 200, quantity: 1 },
];
// High cost-ratio single item → the MIN-MARGIN floor binds ABOVE the max-discount floor.
// price 1000, cost 800: max-discount floor = 900, margin floor = 800/0.85 = 941.
const HIGHCOST = [{ name: 'Artisan Mug', category: 'Home', price: 1000, costPrice: 800, inventory: 40, quantity: 1 }];
const GUEST = { type: 'guest', previousOrders: 0 };
const ctxAt = (offer, cart = CART) => buildPricingContext(cart, SETTINGS, offer, GUEST);

// ── fetch stub helpers ────────────────────────────────────────────────────
const realFetch = global.fetch;
function stubGemini(responder) {
  global.fetch = async (url, opts) => responder(url, opts);
}
function restoreFetch() {
  global.fetch = realFetch;
}
// Build a Gemini generateContent success envelope wrapping `payload`
// (an object → JSON-stringified, or a raw string to test bad output).
function geminiOk(payload) {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) };
}

// ── async test harness ──────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const tests = [];
function test(name, fn) {
  tests.push([name, fn]);
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

// ── 1. Gemini ACCEPT ─────────────────────────────────────────────────────────
test('Gemini ACCEPT: offer near cart total is accepted as-is', async () => {
  stubGemini(() => geminiOk({ decision: 'ACCEPT', counterPrice: null, reason: 'Your offer is fair', confidence: 90 }));
  const raw = await getAiDecision({ cartTotal: 2800, customerOffer: 2750 });
  assert(raw.decision === 'ACCEPT', 'raw decision');
  const r = validateAiDeal(raw, ctxAt(2750), 2750);
  assert(r.valid, 'valid');
  assert(r.deal.decision === 'ACCEPT', `decision ${r.deal.decision}`);
  assert(r.deal.finalPrice === 2750, `finalPrice ${r.deal.finalPrice}`);
  assert(Array.isArray(r.deal.reason) && r.deal.reason.length > 0, 'reason normalised to array');
});

// ── 2. Gemini COUNTER_OFFER ───────────────────────────────────────────────────
test('Gemini COUNTER_OFFER: a valid counter within bounds is honoured', async () => {
  stubGemini(() => geminiOk({ decision: 'COUNTER_OFFER', counterPrice: 2600, reason: 'We can meet partway', confidence: 72 }));
  const raw = await getAiDecision({});
  const r = validateAiDeal(raw, ctxAt(2400), 2400);
  assert(r.valid, 'valid');
  assert(r.deal.decision === 'COUNTER_OFFER', `decision ${r.deal.decision}`);
  assert(r.deal.finalPrice === 2600, `finalPrice ${r.deal.finalPrice}`);
  assert(r.deal.finalPrice >= 2520, 'at/above floor');
  assert(r.deal.discountPercent <= 10 + 1e-9, `discount ${r.deal.discountPercent}`);
});

// ── 3. Gemini REJECT ──────────────────────────────────────────────────────────
test('Gemini REJECT: a very low offer is rejected, best price shown', async () => {
  stubGemini(() => geminiOk({ decision: 'REJECT', counterPrice: null, reason: 'Offer is too low', confidence: 60 }));
  const raw = await getAiDecision({});
  const r = validateAiDeal(raw, ctxAt(800), 800);
  assert(r.valid, 'valid');
  assert(r.deal.decision === 'REJECT', `decision ${r.deal.decision}`);
  assert(r.deal.finalPrice === 2520, `finalPrice ${r.deal.finalPrice}`);
});

// ── 4. Invalid Gemini JSON ────────────────────────────────────────────────────
test('Invalid Gemini JSON: getAiDecision throws (caller will fall back)', async () => {
  stubGemini(() => geminiOk('Sorry, I could not produce a price today.'));
  let threw = false;
  try {
    await getAiDecision({});
  } catch {
    threw = true;
  }
  assert(threw, 'getAiDecision should throw on unparseable content');
});

test('parseDecision: throws on garbage but extracts JSON from fences/prose', () => {
  let threw = false;
  try {
    parseDecision('no json here');
  } catch {
    threw = true;
  }
  assert(threw, 'garbage throws');
  const a = parseDecision('```json\n{"decision":"ACCEPT","counterPrice":null,"reason":"ok","confidence":80}\n```');
  assert(a.decision === 'ACCEPT', 'fenced json parsed');
  const b = parseDecision('Here you go: {"decision":"REJECT","counterPrice":null,"reason":"no","confidence":50} — done');
  assert(b.decision === 'REJECT', 'prose-wrapped json parsed');
});

// ── 5. Gemini failure / timeout → deterministic fallback ──────────────────────
test('Gemini timeout/abort → getAiDecision throws → deterministic fallback runs', async () => {
  stubGemini(() => {
    const e = new Error('The operation was aborted');
    e.name = 'AbortError';
    throw e;
  });
  const ctx = ctxAt(2500);
  let deal;
  try {
    const raw = await getAiDecision({});
    deal = validateAiDeal(raw, ctx, 2500).deal;
  } catch {
    deal = fallbackNegotiate(ctx, 2500); // mirrors the controller's catch → fallback
  }
  assert(deal && deal.engine === 'fallback', `engine ${deal && deal.engine}`);
  assert(deal.finalPrice >= 2520, `finalPrice ${deal.finalPrice}`);
  assert(deal.discountPercent <= 10 + 1e-9, `discount ${deal.discountPercent}`);
});

test('Gemini HTTP error → getAiDecision throws with status only (no body leak)', async () => {
  stubGemini(() => ({ ok: false, status: 503, json: async () => ({}) }));
  let msg = '';
  try {
    await getAiDecision({});
  } catch (e) {
    msg = e.message;
  }
  assert(/HTTP 503/.test(msg), `message ${msg}`);
});

// ── 6. AI attempting to exceed the 10% max discount → server blocks it ────────
test('AI exceeding max discount (counterPrice 2000 on a 2800 cart) is clamped to <=10%', async () => {
  stubGemini(() => geminiOk({ decision: 'COUNTER_OFFER', counterPrice: 2000, reason: 'huge discount', confidence: 95 }));
  const raw = await getAiDecision({});
  const r = validateAiDeal(raw, ctxAt(1800), 1800);
  assert(r.valid, 'valid');
  assert(r.deal.finalPrice >= 2520, `finalPrice ${r.deal.finalPrice} breached floor`);
  assert(r.deal.discountPercent <= 10 + 1e-9, `discount ${r.deal.discountPercent} exceeded 10%`);
  assert(r.deal.adjusted === true, 'guardrail should flag adjustment');
});

// ── 7. AI attempting to violate the 15% min margin → server blocks it ─────────
test('AI violating min margin (below margin floor yet within max discount) is blocked', async () => {
  const ctx = ctxAt(850, HIGHCOST);
  assert(ctx.minimumAllowedPrice === 941, `margin floor should bind at 941, got ${ctx.minimumAllowedPrice}`);
  assert(ctx.discountFloorPrice === 900, `max-discount floor should be 900, got ${ctx.discountFloorPrice}`);
  // 910 respects the 10% discount rule (>=900) but breaks the 15% margin floor (941).
  stubGemini(() => geminiOk({ decision: 'COUNTER_OFFER', counterPrice: 910, reason: 'small discount', confidence: 80 }));
  const raw = await getAiDecision({});
  const r = validateAiDeal(raw, ctx, 850);
  assert(r.valid, 'valid');
  assert(r.deal.finalPrice >= 941, `finalPrice ${r.deal.finalPrice} below margin floor 941`);
  assert(r.deal.finalPrice > 910, 'must be raised above the AI proposal');
  assert(r.deal.adjusted === true, 'guardrail should flag adjustment');
});

// ── 8. Maximum 3 negotiation rounds ──────────────────────────────────────────
test('Max rounds: a 4th-round counter with an offer above the floor → ACCEPT', () => {
  const ctx = ctxAt(2600);
  const counter = validateAiDeal({ decision: 'COUNTER_OFFER', counterPrice: 2700, reason: 'x', confidence: 70 }, ctx, 2600).deal;
  assert(counter.decision === 'COUNTER_OFFER', 'precondition: is a counter');
  const final = enforceMaxRounds(counter, ctx, { customerOffer: 2600, negotiationRound: 4, maxNegotiationRounds: 3 });
  assert(final.decision === 'ACCEPT', `decision ${final.decision}`);
  assert(final.finalPrice === 2600, `finalPrice ${final.finalPrice}`);
});

test('Max rounds: a 4th-round counter with a sub-floor offer → REJECT', () => {
  const ctx = ctxAt(2000);
  const counter = validateAiDeal({ decision: 'COUNTER_OFFER', counterPrice: 2520, reason: 'x', confidence: 70 }, ctx, 2000).deal;
  assert(counter.decision === 'COUNTER_OFFER', 'precondition: is a counter');
  const final = enforceMaxRounds(counter, ctx, { customerOffer: 2000, negotiationRound: 4, maxNegotiationRounds: 3 });
  assert(final.decision === 'REJECT', `decision ${final.decision}`);
  assert(final.finalPrice === 2520, `finalPrice ${final.finalPrice}`);
});

test('Max rounds: within the cap (round 3) a counter is left intact', () => {
  const ctx = ctxAt(2400);
  const counter = validateAiDeal({ decision: 'COUNTER_OFFER', counterPrice: 2600, reason: 'x', confidence: 70 }, ctx, 2400).deal;
  const final = enforceMaxRounds(counter, ctx, { customerOffer: 2400, negotiationRound: 3, maxNegotiationRounds: 3 });
  assert(final.decision === 'COUNTER_OFFER', `decision ${final.decision}`);
  assert(final.finalPrice === 2600, `finalPrice ${final.finalPrice}`);
});

// ── Extra: malformed / unsafe AI output is rejected outright ──────────────────
test('Malformed or unsafe AI output is rejected by the validator', () => {
  const ctx = ctxAt(2500);
  assert(validateAiDeal(null, ctx, 2500).valid === false, 'null');
  assert(validateAiDeal({ decision: 'MAYBE', counterPrice: 2600 }, ctx, 2500).valid === false, 'bad decision');
  assert(validateAiDeal({ decision: 'COUNTER_OFFER', counterPrice: 'abc' }, ctx, 2500).valid === false, 'garbage counterPrice');
  assert(validateAiDeal({ decision: 'COUNTER_OFFER', counterPrice: null }, ctx, 2500).valid === false, 'counter without a price');
});

// ── run ───────────────────────────────────────────────────────────────────
console.log('\nDealAI Gemini integration tests\n');
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log('  ✓', name);
    passed++;
  } catch (e) {
    console.error('  ✗', name, '\n      ', e.message);
    failed++;
  } finally {
    restoreFetch();
  }
}
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);

// Standalone order money-authority tests — no database, no network required.
// Run with:  node server/test/orders.test.js
//
// Proves the SERVER is the sole authority for order money. The order controller
// rebuilds every line from the DB (resolveLines) and recomputes the totals with
// buildCheckoutSummary — the exact pure function exercised here. A negotiated
// price applies ONLY if it still matches this exact cart; a stale/REJECT/forged
// negotiation is ignored, so a client can never inject a discount or a total.

import { buildCheckoutSummary } from '../services/agentTools.js';

// The controller's contract in one place: given TRUSTED db lines (from
// resolveLines) and the SERVER-SIDE negotiation (from peekSessionNegotiation),
// compute the authoritative totals. Mirrors orderController.createOrder.
function computeOrderTotals(dbLines, negotiation) {
  const summary = buildCheckoutSummary(dbLines, { lastNegotiation: negotiation });
  return {
    ...summary,
    totalSavings: summary.catalogueSavings + summary.negotiatedSavings,
  };
}

// ── Fixtures — TRUSTED lines as resolveLines would return them ────────────────
// subtotal   = 1800·1 + 1200·2 = 4200
// originalTotal = 2200·1 + 1500·2 = 5200  → catalogueSavings = 1000
const DB_LINES = [
  { sku: 5, name: 'Aurora Desk Lamp', price: 1800, originalPrice: 2200, quantity: 1, inventory: 40, costPrice: 900 },
  { sku: 9, name: 'Volt Power Bank', price: 1200, originalPrice: 1500, quantity: 2, inventory: 30, costPrice: 700 },
];

// ── Tiny harness ──────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}
const hasCostPrice = (o) => o && Object.prototype.hasOwnProperty.call(o, 'costPrice');

console.log('\nDealAI order money-authority tests\n');

test('totals are recomputed from the DB lines', () => {
  const t = computeOrderTotals(DB_LINES, null);
  assert(t.subtotal === 4200, `subtotal ${t.subtotal}`);
  assert(t.originalTotal === 5200, `originalTotal ${t.originalTotal}`);
  assert(t.catalogueSavings === 1000, `catalogueSavings ${t.catalogueSavings}`);
  assert(t.negotiatedSavings === 0, 'no negotiation → no negotiated savings');
  assert(t.finalTotal === 4200, `finalTotal ${t.finalTotal}`);
  assert(t.totalSavings === 1000, `totalSavings ${t.totalSavings}`);
  assert(t.itemCount === 3, `itemCount ${t.itemCount}`);
  assert(t.ready === true && t.empty === false, 'ready, not empty');
});

test('SECURITY: a client-forged price on a line does not change the trusted math', () => {
  // Even if a caller slips extra junk fields onto a line, only price·quantity
  // (the resolveLines-supplied trusted values) drive the totals.
  const tampered = DB_LINES.map((l) => ({ ...l, clientClaimedTotal: 1, discount: 999 }));
  const t = computeOrderTotals(tampered, null);
  assert(t.finalTotal === 4200, `finalTotal must ignore client fields, got ${t.finalTotal}`);
});

test('a MATCHING negotiation applies and composes with catalogue savings', () => {
  const neg = { decision: 'COUNTER_OFFER', originalPrice: 4200, finalPrice: 3900 };
  const t = computeOrderTotals(DB_LINES, neg);
  assert(t.finalTotal === 3900, `finalTotal ${t.finalTotal}`);
  assert(t.negotiatedSavings === 300, `negotiatedSavings ${t.negotiatedSavings}`);
  assert(t.totalSavings === 1300, `totalSavings should be 1000 + 300, got ${t.totalSavings}`);
});

test('SECURITY: a forged negotiation with a mismatched total is ignored (no injected discount)', () => {
  // A malicious client "peeks" a fake huge discount whose originalPrice doesn't
  // match the real cart → the stale-check drops it entirely.
  const forged = { decision: 'ACCEPT', originalPrice: 999, finalPrice: 1 };
  const t = computeOrderTotals(DB_LINES, forged);
  assert(t.negotiatedSavings === 0, 'forged negotiation must not apply');
  assert(t.finalTotal === 4200, `finalTotal ${t.finalTotal} must stay at the real subtotal`);
});

test('SECURITY: a REJECT negotiation is never applied even if the total matches', () => {
  const rejected = { decision: 'REJECT', originalPrice: 4200, finalPrice: 4200 };
  const t = computeOrderTotals(DB_LINES, rejected);
  assert(t.negotiatedSavings === 0 && t.finalTotal === 4200, 'reject not applied');
});

test('quantity over available inventory is flagged and blocks readiness', () => {
  const short = [{ sku: 9, name: 'Volt Power Bank', price: 1200, originalPrice: 1500, quantity: 100, inventory: 30 }];
  const t = computeOrderTotals(short, null);
  assert(t.issues.length > 0, 'an inventory issue is raised');
  assert(t.ready === false, 'not ready when there are issues');
});

test('SECURITY: no order line ever carries costPrice', () => {
  const t = computeOrderTotals(DB_LINES, { decision: 'COUNTER_OFFER', originalPrice: 4200, finalPrice: 3900 });
  assert(t.items.length === 2, 'two items');
  assert(t.items.every((i) => !hasCostPrice(i)), 'no costPrice in any checkout/order item');
});

test('empty cart → empty flag, not ready, zeroed totals', () => {
  const t = computeOrderTotals([], null);
  assert(t.empty === true && t.ready === false, 'empty & not ready');
  assert(t.finalTotal === 0 && t.totalSavings === 0, 'zeroed');
});

// ── Run ───────────────────────────────────────────────────────────────────────
(async () => {
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log('  ✓', name);
      passed++;
    } catch (e) {
      console.error('  ✗', name, '\n      ', e.message);
      failed++;
    }
  }
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})();

// Standalone agent-tool tests — no database, no network required.
// Run with:  node server/test/agent.test.js
//
// Covers the PURE agent brains (search, multi-signal recommendation, bundle
// detection, deterministic review summary, intent parsing) and the SECURITY
// guardrails (cart-op validation, no costPrice leakage, and that the agent's
// negotiation path can never breach the merchant floor).

import {
  toPublic,
  searchProductsIn,
  scoreRecommendations,
  detectBundle,
  findBundleOpportunities,
  findAccessoriesFor,
  resolveVariantSelection,
  summarizeReviews,
  summarizeOrderHistory,
  parseIntent,
  validateCartOp,
  buildCheckoutSummary,
  MAX_CART_QTY,
} from '../services/agentTools.js';
import { runNegotiation } from '../services/negotiationService.js';

// ── Fixtures (mirror the real Product shape incl. internal costPrice) ─────────
const THEMED_REVIEWS = [
  { user: 'Aarav', rating: 5, title: 'Great', comment: 'very comfortable and great sound', verified: true },
  { user: 'Bela', rating: 4, title: 'Good', comment: 'comfortable fit, nice sound' },
  { user: 'Chetan', rating: 5, title: 'Love it', comment: 'sound is amazing and comfortable', verified: true },
  { user: 'Dia', rating: 2, title: 'Meh', comment: 'battery drains fast' },
];

const CATALOGUE = [
  {
    sku: 1, name: 'Trail Runner Sneakers', brand: 'Stride', category: 'Footwear',
    price: 2000, originalPrice: 2500, costPrice: 1200, inventory: 80,
    rating: 4.5, reviewCount: 150, features: ['breathable', 'cushioned'],
    description: 'Lightweight running sneakers', reviews: [],
  },
  {
    sku: 2, name: 'Ankle Running Socks', brand: 'Stride', category: 'Footwear',
    price: 1400, originalPrice: 2000, costPrice: 600, inventory: 100,
    rating: 4.3, reviewCount: 400, features: ['moisture-wicking'],
    description: 'Cushioned running socks', reviews: [],
  },
  {
    sku: 3, name: 'Studio Headphones', brand: 'Zen', category: 'Electronics',
    price: 5000, originalPrice: 5000, costPrice: 3000, inventory: 5,
    rating: 5.0, reviewCount: 3, features: ['noise cancelling'],
    description: 'Premium studio headphones', reviews: THEMED_REVIEWS,
  },
  {
    sku: 4, name: 'Zen Smart Watch', brand: 'Zen', category: 'Electronics',
    price: 3000, originalPrice: 4000, costPrice: 1500, inventory: 60,
    rating: 4.6, reviewCount: 220, features: ['heart-rate'],
    tags: ['wearable', 'fitness'], // keywords not present in name/brand/category/desc
    description: 'Fitness smart watch', reviews: [],
  },
];

// ── Tiny async-capable harness (same style as negotiation.test.js) ────────────
let passed = 0;
let failed = 0;
const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}
const hasCostPrice = (obj) => obj && Object.prototype.hasOwnProperty.call(obj, 'costPrice');

console.log('\nDealAI agent-tool tests\n');

// ── toPublic: never leaks internal fields ─────────────────────────────────────
test('SECURITY: toPublic strips costPrice and internal data', () => {
  const pub = toPublic(CATALOGUE[0]);
  assert(!hasCostPrice(pub), 'costPrice must not be present');
  assert(pub.sku === 1 && pub.price === 2000, 'keeps safe fields');
  assert(pub.inStock === true, 'derives inStock');
  assert(toPublic(null) === null, 'null-safe');
});

// ── Search ────────────────────────────────────────────────────────────────────
test('search: name match ranks the right product first, no costPrice', () => {
  const res = searchProductsIn(CATALOGUE, 'headphones');
  assert(res.length > 0, 'has results');
  assert(res[0].sku === 3, `expected sku 3 first, got ${res[0].sku}`);
  assert(res.every((p) => !hasCostPrice(p)), 'no costPrice in any result');
});
test('search: empty query falls back to top-rated in-stock', () => {
  const res = searchProductsIn(CATALOGUE, '   ');
  assert(res.length > 0, 'has results');
  assert(res.every((p) => p.inStock), 'all in stock');
});

// ── Recommendation: MULTI-SIGNAL, not pure top rating ─────────────────────────
test('recommend: multi-signal winner beats the highest-rated item', () => {
  const cartLines = [{ sku: 1, brand: 'Stride', category: 'Footwear', quantity: 1 }];
  const recs = scoreRecommendations(CATALOGUE, { cartLines });
  assert(recs.length > 0, 'has recommendations');
  // sku 3 is the highest-rated (5.0) but low-volume/no-discount/no-affinity.
  assert(recs[0].sku === 2, `multi-signal top should be sku 2, got ${recs[0].sku}`);
  assert(recs[0].sku !== 3, 'must NOT just pick the highest-rated');
  assert(!recs.some((r) => r.sku === 1), 'never recommends an item already in the cart');
  assert((recs[0].reasons || []).includes('pairs with your cart'), 'explains cart affinity');
  assert(recs.every((r) => !hasCostPrice(r)), 'no costPrice leaks');
});
test('recommend: rating-only ordering would have differed (proves signals matter)', () => {
  const byRating = [...CATALOGUE].filter((p) => p.sku !== 1).sort((a, b) => b.rating - a.rating);
  assert(byRating[0].sku === 3, 'rating-only top is sku 3');
  const recs = scoreRecommendations(CATALOGUE, { cartLines: [{ sku: 1, brand: 'Stride', category: 'Footwear', quantity: 1 }] });
  assert(recs[0].sku !== byRating[0].sku, 'multi-signal disagrees with rating-only');
});

// ── Bundle detection & opportunities ──────────────────────────────────────────
test('bundle: 2+ distinct items form an eligible bundle when enabled', () => {
  const b = detectBundle([{ quantity: 1 }, { quantity: 2 }], { bundleDiscountEnabled: true });
  assert(b.isBundle === true, 'isBundle');
  assert(b.totalUnits === 3, `totalUnits ${b.totalUnits}`);
  assert(b.dealEligible === true, 'dealEligible when enabled');
});
test('bundle: single item is not a bundle', () => {
  assert(detectBundle([{ quantity: 1 }], {}).isBundle === false, 'single item');
});
test('bundle: disabled merchant setting removes deal eligibility', () => {
  const b = detectBundle([{ quantity: 1 }, { quantity: 1 }], { bundleDiscountEnabled: false });
  assert(b.isBundle === true && b.dealEligible === false, 'bundle but not eligible');
});
test('opportunities: surfaces cart-related items, empty cart → none', () => {
  const cartLines = [{ sku: 1, brand: 'Stride', category: 'Footwear', quantity: 1 }];
  const opps = findBundleOpportunities(CATALOGUE, cartLines);
  assert(opps.some((o) => o.sku === 2), 'suggests the same-brand/category sock');
  assert(findBundleOpportunities(CATALOGUE, []).length === 0, 'empty cart → no opportunities');
});

// ── Review summary (deterministic, never invents) ─────────────────────────────
test('reviews: summary reports correct stats and positive themes', () => {
  const s = summarizeReviews(THEMED_REVIEWS, THEMED_REVIEWS.length);
  assert(s.available === true, 'available');
  assert(s.average === 4, `average ${s.average}`); // (5+4+5+2)/4 = 4
  assert(s.positiveCount === 3 && s.negativeCount === 1, `pos ${s.positiveCount} neg ${s.negativeCount}`);
  assert(s.positiveThemes.includes('comfortable'), `themes ${s.positiveThemes.join(',')}`);
  assert(s.verifiedCount === 2, `verified ${s.verifiedCount}`);
});
test('reviews: gracefully reports when there is nothing to summarize', () => {
  assert(summarizeReviews([], 0).available === false, 'empty array');
  assert(summarizeReviews(undefined).available === false, 'undefined');
});

// ── Intent parsing (drives the deterministic fallback agent) ──────────────────
test('intent: maps common phrasings to the right intent', () => {
  const cases = [
    ['clear my cart', 'clear_cart'],
    ['remove the sneakers', 'remove'],
    ['add the smart watch', 'add'],
    ['get me the best deal', 'negotiate'], // add-word present but negotiation wins
    ['negotiate a better price', 'negotiate'],
    ['best deal lao', 'negotiate'],
    ['deal accept karo', 'accept_deal'], // accept beats the greedy "deal" negotiate match
    ['accept the deal', 'accept_deal'],
    ['deal accept kar do', 'accept_deal'],
    ['lock in the deal', 'accept_deal'],
    ['compare the watch and headphones', 'compare'],
    ['are these headphones any good?', 'reviews'],
    ['what pairs with my cart', 'bundle'],
    ['recommend an upgrade', 'recommend'],
    ["what's in my cart", 'view_cart'],
    ['show me headphones', 'search'],
  ];
  for (const [msg, expected] of cases) {
    const got = parseIntent(msg).intent;
    assert(got === expected, `"${msg}" → ${got}, expected ${expected}`);
  }
});

test('intent: "accept the deal" is accept_deal, but negotiating stays negotiate', () => {
  // Accept phrasings must lock in the existing deal, never re-open negotiation.
  for (const msg of ['deal accept karo', 'accept the deal', 'confirm the deal', 'deal pakka karo', 'apply the deal', 'lock in the deal']) {
    assert(parseIntent(msg).intent === 'accept_deal', `"${msg}" → ${parseIntent(msg).intent}, expected accept_deal`);
  }
  // Pure negotiation asks (no accept word) must still be negotiate.
  for (const msg of ['best deal lao', 'deal lao', 'get me the best deal', 'negotiate a lower price', 'can you make it cheaper']) {
    assert(parseIntent(msg).intent === 'negotiate', `"${msg}" → ${parseIntent(msg).intent}, expected negotiate`);
  }
});
test('SECURITY: validateCartOp rejects unknown / invalid quantities', () => {
  assert(validateCartOp({ products: CATALOGUE, op: 'add', productId: 999, quantity: 1 }).valid === false, 'unknown id');
  assert(validateCartOp({ products: CATALOGUE, op: 'add', productId: 1, quantity: -2 }).valid === false, 'negative qty');
  assert(validateCartOp({ products: CATALOGUE, op: 'add', productId: 1, quantity: 1.5 }).valid === false, 'non-integer qty');
  assert(validateCartOp({ products: CATALOGUE, op: 'add', productId: 1, quantity: MAX_CART_QTY + 1 }).valid === false, 'over max');
  assert(validateCartOp({ products: CATALOGUE, op: 'frobnicate', productId: 1 }).valid === false, 'unknown op');
});
test('SECURITY: validated add uses the DB price, never a caller-supplied one', () => {
  const r = validateCartOp({ products: CATALOGUE, op: 'add', productId: 1, quantity: 2, price: 1 });
  assert(r.valid === true, 'valid');
  assert(r.action.price === 2000, `price must come from catalogue, got ${r.action.price}`);
  assert(r.action.productId === 1 && r.action.quantity === 2, 'normalised action');
  assert(!hasCostPrice(r.action), 'action never carries costPrice');
});
test('validateCartOp: clear and remove normalise correctly', () => {
  assert(validateCartOp({ products: CATALOGUE, op: 'clear' }).action.op === 'clear', 'clear');
  const rem = validateCartOp({ products: CATALOGUE, op: 'remove', productId: 2 });
  assert(rem.valid && rem.action.op === 'remove' && rem.action.productId === 2, 'remove');
});

// ── Agent negotiation path is guardrailed (deterministic — AI disabled) ───────
const NEG_SETTINGS = {
  maxDiscountPercent: 10,
  minimumMarginPercent: 15,
  bundleDiscountEnabled: true,
  aiNegotiationEnabled: false, // force the deterministic engine — no network
  maxNegotiationRounds: 3,
};
const NEG_LINES = [
  { sku: 1, name: 'Premium Sneakers', category: 'Footwear', price: 2000, costPrice: 1400, inventory: 80, quantity: 1 },
  { sku: 2, name: 'Oversized T-Shirt', category: 'Clothing', price: 800, costPrice: 350, inventory: 200, quantity: 1 },
]; // cartTotal 2800, 10% floor = 2520

test('SECURITY: startNegotiation (via runNegotiation) never sells below the floor', async () => {
  const { deal } = await runNegotiation({ lines: NEG_LINES, settings: NEG_SETTINGS, offer: 1000, negotiationRound: 1 });
  assert(deal.decision !== 'ACCEPT', `must not accept 1000, got ${deal.decision}`);
  assert(deal.finalPrice >= 2520, `finalPrice ${deal.finalPrice} < floor 2520`);
  assert(deal.discountPercent <= 10 + 1e-9, `discount ${deal.discountPercent}`);
});
test('agent negotiation: a fair offer within max discount is accepted', async () => {
  const { deal } = await runNegotiation({ lines: NEG_LINES, settings: NEG_SETTINGS, offer: 2700, negotiationRound: 1 });
  assert(deal.decision === 'ACCEPT', `decision ${deal.decision}`);
  assert(deal.finalPrice === 2700, `finalPrice ${deal.finalPrice}`);
});

// ── Search now also matches `tags` (PART 1 richer catalogue) ──────────────────
test('search: matches a tag that is absent from name/brand/category/desc', () => {
  const res = searchProductsIn(CATALOGUE, 'wearable');
  assert(res.length > 0, 'has results for a tag-only query');
  assert(res[0].sku === 4, `expected sku 4 via tag, got ${res[0].sku}`);
  assert(res.every((p) => !hasCostPrice(p)), 'no costPrice leaks');
});

// ── Intent: checkout (PART 15) ────────────────────────────────────────────────
test('intent: checkout phrasings map to the checkout intent (not add/negotiate)', () => {
  const checkoutCases = ['prepare checkout', 'proceed to checkout', 'i\'m ready to buy', 'prepare my order', 'complete my purchase', 'review my cart'];
  for (const msg of checkoutCases) {
    assert(parseIntent(msg).intent === 'checkout', `"${msg}" → ${parseIntent(msg).intent}, expected checkout`);
  }
  // Regression: negotiation/add phrasings must still win.
  assert(parseIntent('get me the best deal').intent === 'negotiate', 'best deal still negotiate');
  assert(parseIntent('add the smart watch').intent === 'add', 'add still add');
});

// ── Intent: autopick (PART 5 — autonomous selection → propose + confirm) ──────
test('intent: autonomous-pick phrasings map to autopick (not add/negotiate/recommend)', () => {
  const autopickCases = [
    'you decide and add the best product for my cart',
    'you pick the best one for me',
    'pick the best one for me',
    'choose the best product for my cart',
    'surprise me',
    'add the best one yourself',
  ];
  for (const msg of autopickCases) {
    assert(parseIntent(msg).intent === 'autopick', `"${msg}" → ${parseIntent(msg).intent}, expected autopick`);
  }
  // Regression: explicit named adds, negotiation, and plain advice must NOT be autopick.
  assert(parseIntent('add the smart watch').intent === 'add', 'named add stays add');
  assert(parseIntent('add the wireless earbuds to my cart').intent === 'add', 'named add with cart stays add');
  assert(parseIntent('get me the best deal').intent === 'negotiate', 'best deal stays negotiate');
  assert(parseIntent('recommend an upgrade').intent === 'recommend', 'plain advice stays recommend');
});

// ── buildCheckoutSummary (PART 15 — pure, safe, honest) ───────────────────────
const CO_LINES = [
  { sku: 1, name: 'Trail Runner Sneakers', price: 2000, originalPrice: 2500, quantity: 1, inventory: 80 },
  { sku: 2, name: 'Ankle Running Socks', price: 1400, originalPrice: 2000, quantity: 2, inventory: 100 },
]; // subtotal 2000 + 2800 = 4800; originalTotal 2500 + 4000 = 6500; catalogueSavings 1700

test('checkout: empty cart → not ready, empty flag, zeroed totals', () => {
  const s = buildCheckoutSummary([], {});
  assert(s.empty === true && s.ready === false, 'empty & not ready');
  assert(s.itemCount === 0 && s.subtotal === 0 && s.finalTotal === 0, 'zeroed');
  assert(Array.isArray(s.items) && s.items.length === 0, 'no items');
});

test('checkout: normal cart computes subtotal, catalogue savings and item count', () => {
  const s = buildCheckoutSummary(CO_LINES, {});
  assert(s.empty === false && s.ready === true, 'ready, not empty');
  assert(s.itemCount === 3, `itemCount ${s.itemCount}`);
  assert(s.subtotal === 4800, `subtotal ${s.subtotal}`);
  assert(s.originalTotal === 6500, `originalTotal ${s.originalTotal}`);
  assert(s.catalogueSavings === 1700, `catalogueSavings ${s.catalogueSavings}`);
  assert(s.negotiatedSavings === 0, 'no negotiation applied');
  assert(s.finalTotal === 4800, `finalTotal ${s.finalTotal}`);
  assert(s.items.every((i) => !hasCostPrice(i)), 'no costPrice in checkout items');
});

test('checkout: a MATCHING negotiation applies negotiated savings', () => {
  const lastNegotiation = { decision: 'COUNTER_OFFER', originalPrice: 4800, finalPrice: 4400 };
  const s = buildCheckoutSummary(CO_LINES, { lastNegotiation });
  assert(s.finalTotal === 4400, `finalTotal ${s.finalTotal}`);
  assert(s.negotiatedSavings === 400, `negotiatedSavings ${s.negotiatedSavings}`);
});

test('checkout: a STALE negotiation (total changed) is ignored — no unearned discount', () => {
  const staleNegotiation = { decision: 'COUNTER_OFFER', originalPrice: 2800, finalPrice: 2500 };
  const s = buildCheckoutSummary(CO_LINES, { lastNegotiation: staleNegotiation });
  assert(s.negotiatedSavings === 0, 'stale negotiation must not apply');
  assert(s.finalTotal === 4800, `finalTotal ${s.finalTotal}`);
});

test('checkout: a REJECT negotiation is never applied', () => {
  const rejected = { decision: 'REJECT', originalPrice: 4800, finalPrice: 4800 };
  const s = buildCheckoutSummary(CO_LINES, { lastNegotiation: rejected });
  assert(s.negotiatedSavings === 0 && s.finalTotal === 4800, 'reject not applied');
});

test('checkout: insufficient inventory flags an issue and blocks readiness', () => {
  const shortLines = [{ sku: 3, name: 'Studio Headphones', price: 5000, originalPrice: 5000, quantity: 10, inventory: 5 }];
  const s = buildCheckoutSummary(shortLines, {});
  assert(s.issues.length > 0, 'has an inventory issue');
  assert(s.ready === false, 'not ready when there are issues');
});

// ── Intent: my_orders / order_details (Day 5 — personalization routing) ───────
test('intent: order-history phrasings map to my_orders (not add/search)', () => {
  const historyCases = [
    'what did I order recently',
    'show my orders',
    'my order history',
    'did I buy the headphones before',
    'what have I bought',
    'show my past purchases',
  ];
  for (const msg of historyCases) {
    assert(parseIntent(msg).intent === 'my_orders', `"${msg}" → ${parseIntent(msg).intent}, expected my_orders`);
  }
  // Regression: normal shopping phrasings must NOT be captured by order intents.
  assert(parseIntent('add the smart watch').intent === 'add', 'named add stays add');
  assert(parseIntent('I want to order some headphones').intent !== 'my_orders', 'a shopping "order" verb is not history');
  assert(parseIntent('get me the best deal').intent === 'negotiate', 'best deal stays negotiate');
});

test('intent: single/most-recent order phrasings map to order_details', () => {
  const detailCases = ['show my last order', 'order details', 'track my order', 'details of my latest order', "what's the status of my order"];
  for (const msg of detailCases) {
    assert(parseIntent(msg).intent === 'order_details', `"${msg}" → ${parseIntent(msg).intent}, expected order_details`);
  }
});

// ── summarizeOrderHistory (Day 5 — real data, never fabricated) ───────────────
const ORDER_HISTORY = [
  {
    id: 'o1', createdAt: '2026-02-01T10:00:00.000Z', finalTotal: 4200, totalSavings: 1000, status: 'Delivered',
    items: [
      { productId: 3, name: 'Studio Headphones', brand: 'Zen', category: 'Electronics', quantity: 2 },
      { productId: 4, name: 'Zen Smart Watch', brand: 'Zen', category: 'Electronics', quantity: 1 },
    ],
  },
  {
    id: 'o2', createdAt: '2026-01-15T10:00:00.000Z', finalTotal: 1400, totalSavings: 600, status: 'Placed',
    items: [{ productId: 2, name: 'Ankle Running Socks', brand: 'Stride', category: 'Footwear', quantity: 2 }],
  },
];

test('history: infers preferred categories + recent items from real snapshots', () => {
  const h = summarizeOrderHistory(ORDER_HISTORY);
  assert(h.hasHistory === true, 'has history');
  assert(h.orderCount === 2, `orderCount ${h.orderCount}`);
  assert(h.totalSpent === 5600, `totalSpent ${h.totalSpent}`); // 4200 + 1400
  assert(h.totalSaved === 1600, `totalSaved ${h.totalSaved}`); // 1000 + 600
  assert(h.topCategories[0] === 'Electronics', `top category ${h.topCategories[0]}`); // 2 units vs 2? Electronics appears in 2 items
  assert(h.topCategories.includes('Footwear'), 'includes Footwear');
  // Recent items newest-first, distinct by sku.
  assert(h.recentItems[0].productId === 3, `newest first, got sku ${h.recentItems[0].productId}`);
  assert(h.recentItems.some((i) => i.productId === 2), 'includes the socks');
  assert(new Set(h.recentItems.map((i) => i.productId)).size === h.recentItems.length, 'recent items are distinct');
});

test('history: degrades gracefully with no orders (never fabricates)', () => {
  const h = summarizeOrderHistory([]);
  assert(h.hasHistory === false, 'no history');
  assert(h.orderCount === 0 && h.recentItems.length === 0, 'empty');
  assert(h.topCategories.length === 0 && h.topBrands.length === 0, 'no inferred preferences');
  assert(summarizeOrderHistory(undefined).hasHistory === false, 'undefined-safe');
  assert(summarizeOrderHistory(null).hasHistory === false, 'null-safe');
});

test('SECURITY: order-history summary never carries passwordHash / costPrice', () => {
  // Even if upstream data were polluted, the summary output must stay clean.
  const polluted = [{
    createdAt: '2026-02-01T10:00:00.000Z', finalTotal: 100, totalSavings: 0, status: 'Placed',
    passwordHash: 'scrypt$deadbeef$cafef00d',
    items: [{ productId: 1, name: 'X', brand: 'B', category: 'C', quantity: 1, costPrice: 999 }],
  }];
  const h = summarizeOrderHistory(polluted);
  const json = JSON.stringify(h);
  assert(!json.includes('passwordHash') && !json.includes('scrypt$'), 'no passwordHash leaks');
  assert(!json.includes('costPrice') && !json.includes('999'), 'no costPrice leaks');
  assert(h.recentItems.every((i) => !Object.prototype.hasOwnProperty.call(i, 'costPrice')), 'recent items are cost-free');
});

// ── Intent: Day 6 Hinglish + new cart intents ────────────────────────────────
test('intent: analyze_cart (English + Hinglish), never captures "review my cart"', () => {
  for (const msg of ['analyze my cart', 'analyse my cart', 'mere cart ko analyze karo', 'can you analyze the cart']) {
    assert(parseIntent(msg).intent === 'analyze_cart', `"${msg}" → ${parseIntent(msg).intent}, expected analyze_cart`);
  }
  // Regression: "review my cart" is a CHECKOUT phrasing, not analysis.
  assert(parseIntent('review my cart').intent === 'checkout', 'review my cart stays checkout');
});

test('intent: update_qty needs an explicit number and returns the quantity', () => {
  const cases = [
    ['quantity 2 kar do', 2],
    ['make it 3', 3],
    ['set it to 5', 5],
    ['change the sneakers to 4', 4],
    ['2 kardo', 2],
  ];
  for (const [msg, qty] of cases) {
    const r = parseIntent(msg);
    assert(r.intent === 'update_qty', `"${msg}" → ${r.intent}, expected update_qty`);
    assert(r.quantity === qty, `"${msg}" quantity ${r.quantity}, expected ${qty}`);
  }
  // Regression: a plain add without a number must NOT be update_qty.
  assert(parseIntent('add the smart watch').intent === 'add', 'numberless add stays add');
  assert(parseIntent('remove the sneakers').intent === 'remove', 'numberless remove stays remove');
});

test('intent: Hinglish add / remove / checkout / autopick map correctly', () => {
  // add
  for (const msg of ['isko cart mein daal do', 'ye add karo', 'le lo', 'add kar do']) {
    assert(parseIntent(msg).intent === 'add', `"${msg}" → ${parseIntent(msg).intent}, expected add`);
  }
  // remove
  for (const msg of ['isko hata do', 'cart se nikaal do', 'ise hatao']) {
    assert(parseIntent(msg).intent === 'remove', `"${msg}" → ${parseIntent(msg).intent}, expected remove`);
  }
  // checkout
  for (const msg of ['checkout karo', 'order kar do', 'khareedo', 'payment karo']) {
    assert(parseIntent(msg).intent === 'checkout', `"${msg}" → ${parseIntent(msg).intent}, expected checkout`);
  }
  // autopick (delegation)
  for (const msg of ['tum decide karo', 'best wala choose karo', 'tum hi decide kar do']) {
    assert(parseIntent(msg).intent === 'autopick', `"${msg}" → ${parseIntent(msg).intent}, expected autopick`);
  }
});

test('intent: a pronoun-only add yields an empty query (fallback uses the selection)', () => {
  // "isko daal do" / "add it" carry no product noun — the fallback must lean on
  // the current selection, so the parsed query should be empty (no stray tokens).
  assert(parseIntent('isko daal do').query.trim() === '', `expected empty query, got "${parseIntent('isko daal do').query}"`);
  assert(parseIntent('add it').query.trim() === '', `expected empty query, got "${parseIntent('add it').query}"`);
});

// ── resolveVariantSelection (PART 2/8 — validates REAL options, never invents) ─
const VARIANT_PRODUCT = { sku: 20, name: 'Classic Tee', colors: ['Black', 'White', 'Navy'], sizes: ['S', 'M', 'L'] };

test('variant: missing choices → needs_selection with the REAL options', () => {
  const r = resolveVariantSelection(VARIANT_PRODUCT, {});
  assert(r.status === 'needs_selection', `status ${r.status}`);
  assert(r.needs.includes('color') && r.needs.includes('size'), `needs ${r.needs}`);
  assert(r.options.colors.length === 3 && r.options.sizes.length === 3, 'offers real options');
  assert(r.name === 'Classic Tee' && r.productId === 20, 'identifies the product');
});

test('variant: valid choice is accepted and returns the CANONICAL spelling', () => {
  const r = resolveVariantSelection(VARIANT_PRODUCT, { color: 'black', size: 'm' });
  assert(r.status === 'ok', `status ${r.status}`);
  assert(r.selection.color === 'Black', `canonical color ${r.selection.color}`);
  assert(r.selection.size === 'M', `canonical size ${r.selection.size}`);
});

test('variant: an invalid value is flagged (never silently accepted / invented)', () => {
  const r = resolveVariantSelection(VARIANT_PRODUCT, { color: 'purple', size: 'M' });
  assert(r.status === 'needs_selection', `status ${r.status}`);
  assert(r.invalid.includes('color'), `invalid ${r.invalid}`);
  assert(!('color' in (r.selection || {})), 'invalid color is not selected');
});

test('variant: no-variant product → ok with an empty selection; null → error', () => {
  const ok = resolveVariantSelection({ sku: 21, name: 'USB Cable' });
  assert(ok.status === 'ok' && Object.keys(ok.selection).length === 0, 'no variants → clean ok');
  assert(resolveVariantSelection(null).status === 'error', 'null product → error');
});

// ── findAccessoriesFor (PART 5 — real complementary items, cart-aware) ─────────
const ACC_CATALOGUE = [
  { sku: 10, name: 'UltraBook 14 Laptop', brand: 'Acme', category: 'Electronics', subcategory: 'Laptops', price: 55000, originalPrice: 60000, costPrice: 40000, inventory: 20, rating: 4.5, reviewCount: 100, reviews: [] },
  { sku: 11, name: 'Laptop Backpack', brand: 'Carry', category: 'Accessories', subcategory: 'Bags', price: 1500, originalPrice: 2000, costPrice: 700, inventory: 50, rating: 4.4, reviewCount: 200, reviews: [] },
  { sku: 12, name: 'Wireless Mouse', brand: 'Click', category: 'Electronics', subcategory: 'Mice', price: 800, originalPrice: 1000, costPrice: 300, inventory: 100, rating: 4.2, reviewCount: 300, reviews: [] },
  { sku: 13, name: 'Ankle Running Socks', brand: 'Stride', category: 'Footwear', subcategory: 'Socks', price: 400, originalPrice: 600, costPrice: 150, inventory: 100, rating: 4.0, reviewCount: 50, reviews: [] },
];

test('accessories: a laptop in the cart surfaces a bag + mouse, never itself', () => {
  const cart = [{ sku: 10, name: 'UltraBook 14 Laptop', category: 'Electronics', subcategory: 'Laptops', quantity: 1 }];
  const acc = findAccessoriesFor(ACC_CATALOGUE, cart);
  const skus = acc.map((a) => a.sku);
  assert(skus.includes(11), `expected the bag (11), got ${skus}`);
  assert(skus.includes(12), `expected the mouse (12), got ${skus}`);
  assert(!skus.includes(10), 'never suggests the cart item itself');
  assert(!skus.includes(13), 'unrelated footwear is not an accessory');
  assert(acc.every((a) => !Object.prototype.hasOwnProperty.call(a, 'costPrice')), 'no costPrice leaks');
});

test('accessories: empty cart → no suggestions (never forced)', () => {
  assert(findAccessoriesFor(ACC_CATALOGUE, []).length === 0, 'empty cart → none');
  assert(findAccessoriesFor(ACC_CATALOGUE, undefined).length === 0, 'undefined cart → none');
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

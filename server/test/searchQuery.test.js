// Standalone tests for the SHARED search brain — no DB, no network.
// Run with:  node server/test/searchQuery.test.js
//
// searchQuery.js is the single parser used by BOTH the website search and the AI
// agent search, so these tests lock down the behaviour they both depend on:
//   • budget parsing in English AND Hinglish
//   • stopword / filler stripping + synonym expansion (incl. plural fallback)
//   • word-boundary matching (so "phone" never bleeds into "headphones")
//   • soft budget ranking (within-budget first, but never an empty result)
//   • the Mongo keyword filter used to build the website's candidate set

import {
  parseBudget,
  extractKeywords,
  expandTerms,
  buildSearchSpec,
  scoreProductForSpec,
  rankProductsForSpec,
  keywordMongoFilter,
} from '../utils/searchQuery.js';

// ── Fixtures (real Product shape) ─────────────────────────────────────────────
const CAT = [
  { sku: 1, name: 'Aurora Smartphone 5G', brand: 'Aurora', category: 'Electronics', subcategory: 'Smartphones', price: 25000, originalPrice: 28000, rating: 4.5, inventory: 10, tags: [], features: [], description: 'A great everyday phone' },
  { sku: 2, name: 'Aurora Smartphone Pro', brand: 'Aurora', category: 'Electronics', subcategory: 'Smartphones', price: 45000, originalPrice: 48000, rating: 4.7, inventory: 5, tags: [], features: [], description: 'Flagship phone' },
  { sku: 3, name: 'BoomX Headphones', brand: 'BoomX', category: 'Electronics', subcategory: 'Headphones', price: 3000, originalPrice: 4000, rating: 4.3, inventory: 20, tags: [], features: [], description: 'Over-ear headphones' },
  { sku: 4, name: 'ProBook Laptop 15', brand: 'ProBook', category: 'Electronics', subcategory: 'Laptops', price: 55000, originalPrice: 60000, rating: 4.4, inventory: 8, tags: [], features: [], description: 'Work laptop' },
];

// ── Tiny harness ──────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'assertion failed'); };

console.log('\nDealAI shared search-brain tests\n');

// ── parseBudget: maxPrice (English + Hinglish) ────────────────────────────────
test('budget: English upper-bound phrasings', () => {
  assert(parseBudget('best phone under 30000').maxPrice === 30000, 'under');
  assert(parseBudget('laptop below 60000').maxPrice === 60000, 'below');
  assert(parseBudget('headphones up to 5000').maxPrice === 5000, 'up to');
  assert(parseBudget('phone within 20000').maxPrice === 20000, 'within');
  assert(parseBudget('budget of 20000').maxPrice === 20000, 'budget of');
  assert(parseBudget('gaming laptop under 40k').maxPrice === 40000, 'k unit');
});

test('budget: Hinglish upper-bound phrasings', () => {
  assert(parseBudget('mujhe 30000 ke andar phone chahiye').maxPrice === 30000, 'ke andar');
  assert(parseBudget('20000 se kam ka laptop').maxPrice === 20000, 'se kam');
  assert(parseBudget('40k tak').maxPrice === 40000, 'tak + k');
  assert(parseBudget('phone 15000 ke neeche').maxPrice === 15000, 'ke neeche');
});

test('budget: lower-bound phrasings (English + Hinglish)', () => {
  assert(parseBudget('phone above 5000').minPrice === 5000, 'above');
  assert(parseBudget('laptop over 10000').minPrice === 10000, 'over');
  assert(parseBudget('5000 se upar').minPrice === 5000, 'se upar');
  assert(parseBudget('at least 8000').minPrice === 8000, 'at least');
});

test('budget: no budget mentioned → both null', () => {
  const b = parseBudget('show me some phones');
  assert(b.minPrice === null && b.maxPrice === null, 'no budget');
  assert(parseBudget('').maxPrice === null, 'empty string safe');
  assert(parseBudget(undefined).maxPrice === null, 'undefined safe');
});

// ── Keyword extraction + synonym expansion ────────────────────────────────────
test('keywords: strips filler + numbers, keeps product nouns (Hinglish)', () => {
  const kw = extractKeywords('mujhe 30000 ke andar best phone chahiye');
  assert(kw.includes('phone'), 'keeps "phone"');
  for (const junk of ['mujhe', 'best', 'chahiye', 'ke', 'andar', '30000']) {
    assert(!kw.includes(junk), `strips "${junk}"`);
  }
});

test('synonyms: a single word expands to its whole group', () => {
  const g = expandTerms(['phone']);
  assert(g.includes('smartphone') && g.includes('mobile'), `phone group ${g}`);
});

test('synonyms: plural query still resolves to its group', () => {
  assert(expandTerms(['phones']).includes('smartphone'), 'phones → smartphone');
  assert(expandTerms(['laptops']).includes('laptop'), 'laptops → laptop');
  assert(expandTerms(['watches']).includes('smartwatch'), 'watches → smartwatch');
});

// ── Word-boundary matching (NO substring bleed) ───────────────────────────────
test('no-bleed: "phone" must NOT match "headphones"', () => {
  assert(scoreProductForSpec(CAT[2], ['phone']) === 0, '"phone" scores 0 on headphones');
  // ...but "headphone" DOES match "headphones".
  assert(scoreProductForSpec(CAT[2], ['headphone']) > 0, '"headphone" matches headphones');
});

test('ranking: a phone query returns phones only, best-rated first, no headphones', () => {
  const spec = buildSearchSpec('phone');
  const res = rankProductsForSpec(CAT, spec, { limit: 10 });
  assert(res.length === 2, `expected 2 phones, got ${res.length}`);
  assert(!res.some((p) => p.sku === 3), 'never returns the headphones');
  assert(!res.some((p) => p.sku === 4), 'never returns the laptop');
});

test('ranking: a headphones query returns the headphones', () => {
  const res = rankProductsForSpec(CAT, buildSearchSpec('headphones'), { limit: 10 });
  assert(res.some((p) => p.sku === 3), 'includes the headphones');
  assert(!res.some((p) => p.sku === 1 || p.sku === 2), 'no phones bleed in');
});

// ── Soft budget ranking (within-budget first, never empty) ────────────────────
test('ranking: budget puts within-budget first but still shows over-budget last', () => {
  const spec = buildSearchSpec('phone under 30000'); // only sku1 (25000) is within budget
  const res = rankProductsForSpec(CAT, spec, { limit: 10 });
  assert(res[0].sku === 1, `within-budget phone first, got ${res[0].sku}`);
  assert(res.some((p) => p.sku === 2), 'over-budget phone still shown (honest, not hidden)');
  assert(res.length === 2, 'never drops a genuine keyword match');
});

test('ranking: an impossible budget never returns an empty list', () => {
  const spec = buildSearchSpec('phone under 1000'); // nothing within budget
  const res = rankProductsForSpec(CAT, spec, { limit: 10 });
  assert(res.length === 2, `still returns matches over budget, got ${res.length}`);
});

test('ranking: no keywords → top-rated, in-stock preferred', () => {
  const res = rankProductsForSpec(CAT, buildSearchSpec(''), { limit: 10 });
  assert(res[0].sku === 2, `top-rated first (4.7), got ${res[0].sku}`);
});

// ── buildSearchSpec: explicit bounds win over parsed text ──────────────────────
test('spec: explicit price bounds override anything parsed from the sentence', () => {
  const spec = buildSearchSpec('phone under 30000', { explicitMax: 50000 });
  assert(spec.maxPrice === 50000, `explicit max wins, got ${spec.maxPrice}`);
});

// ── keywordMongoFilter: candidate-set filter for the website path ─────────────
test('mongo filter: null with no keywords, $or with keywords', () => {
  assert(keywordMongoFilter(buildSearchSpec('')) === null, 'no keywords → null');
  const f = keywordMongoFilter(buildSearchSpec('phone'));
  assert(f && Array.isArray(f.$or) && f.$or.length > 0, 'builds an $or clause');
});

// ── Run ───────────────────────────────────────────────────────────────────────
for (const { name, fn } of tests) {
  try {
    fn();
    console.log('  ✓', name);
    passed++;
  } catch (e) {
    console.error('  ✗', name, '\n      ', e.message);
    failed++;
  }
}
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);

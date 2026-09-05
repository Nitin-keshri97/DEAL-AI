// ─────────────────────────────────────────────────────────────────────────
// searchQuery.js — PURE natural-language → search-spec parser (no I/O).
//
// One shared brain for BOTH the website search (productController.searchProducts)
// and the AI agent search (agentTools.searchProductsIn) so the two always agree
// on the SAME real MongoDB data. It understands:
//   • budgets, in English AND Hinglish: "under 30000", "30000 ke andar",
//     "20000 se kam", "40k tak", "above 5000", "5000 se upar"
//   • Hinglish / filler shopping words: "mujhe … chahiye", "dikhao", "wala",
//     "best", "sasta" — stripped so they don't pollute keyword matching
//   • synonyms: phone↔smartphone↔mobile, laptop↔notebook, headphone↔earbuds, …
//
// It NEVER invents products or prices — it only turns free text into
// { keywords, minPrice, maxPrice } and a scorer the callers run over REAL
// catalogue rows. All prices/ids still come from MongoDB, never from here.
// ─────────────────────────────────────────────────────────────────────────

const norm = (s) => String(s ?? '').toLowerCase().trim();

// Base + Hinglish/shopping filler words that carry no product meaning. Product
// nouns (phone, laptop, mouse, gaming, wireless, brand names …) are NOT here.
const STOPWORDS = new Set([
  // english structural
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been',
  'it', 'its', 'this', 'that', 'these', 'those', 'to', 'of', 'in', 'on', 'for',
  'with', 'at', 'by', 'from', 'as', 'i', 'me', 'my', 'you', 'your', 'they', 'them',
  'so', 'very', 'really', 'just', 'not', 'no', 'too', 'about', 'then', 'than',
  'has', 'have', 'had', 'do', 'does', 'did', 'if', 'up', 'us', 'we',
  // english shopping filler
  'show', 'find', 'search', 'looking', 'look', 'need', 'want', 'get', 'give',
  'please', 'some', 'any', 'good', 'best', 'better', 'top', 'nice', 'great',
  'cheap', 'cheapest', 'buy', 'order', 'want', 'would', 'like', 'can', 'could',
  'recommend', 'suggest', 'help', 'price', 'priced', 'cost', 'range', 'budget',
  'rs', 'inr', 'rupees', 'rupee', 'under', 'below', 'within', 'over', 'above',
  // hinglish filler
  'mujhe', 'muje', 'mera', 'meri', 'mere', 'chahiye', 'chahie', 'chaiye', 'chahiya',
  'dikhao', 'dikha', 'dikhaao', 'dikhado', 'batao', 'bata', 'bta', 'do', 'de',
  'karo', 'kardo', 'kar', 'kro', 'kya', 'hai', 'hain', 'ke', 'ka', 'ki',
  'ko', 'se', 'me', 'mein', 'par', 'aur', 'ya', 'wala', 'wali', 'wale', 'accha',
  'acha', 'achha', 'sabse', 'sasta', 'sasti', 'mehenga', 'koi', 'kuch', 'ek',
  'bhi', 'toh', 'to', 'na', 'hi', 'jo', 'andar', 'neeche', 'niche',
  'upar', 'uper', 'zyada', 'jyada', 'tak', 'kam',
]);

// Synonym groups: any token in a group expands to the whole group so a query in
// one word ("phone") still matches products described with another ("smartphone",
// subcategory "Smartphones"). Groups carry the common plural forms too, so the
// word-boundary scorer matches "phone" ↔ "smartphones" without a substring bleed
// (plain substring would wrongly match "phone" inside "headphones").
const SYNONYM_GROUPS = [
  ['phone', 'smartphone', 'smartphones', 'mobile', 'mobiles', 'cellphone', 'cell', 'android', 'iphone'],
  ['laptop', 'laptops', 'notebook', 'ultrabook', 'macbook'],
  ['headphone', 'headphones', 'headset', 'headsets', 'earphone', 'earphones', 'earbud', 'earbuds', 'buds', 'tws'],
  ['tv', 'television', 'televisions'],
  ['watch', 'watches', 'smartwatch', 'smartwatches', 'wearable'],
  ['mouse', 'mice'],
  ['keyboard', 'keyboards', 'keypad'],
  ['bag', 'bags', 'backpack', 'backpacks', 'rucksack', 'sleeve', 'duffel'],
  ['shoe', 'shoes', 'sneaker', 'sneakers', 'footwear', 'trainers'],
  ['charger', 'charging', 'adapter', 'adaptor'],
  ['speaker', 'speakers', 'soundbar'],
  ['tablet', 'tablets', 'ipad'],
  ['bottle', 'bottles', 'flask'],
  ['tshirt', 'tshirts', 'tee', 'tees'],
  ['jacket', 'jackets', 'hoodie', 'hoodies'],
];
const SYNONYM_INDEX = (() => {
  const idx = new Map();
  for (const group of SYNONYM_GROUPS) {
    for (const w of group) idx.set(w, group);
  }
  return idx;
})();

// ── Budget parsing (English + Hinglish) ─────────────────────────────────────
const AMOUNT = String.raw`(?:₹|rs\.?|inr)?\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*(k|hundred|thousand|lakh)?`;

function toAmount(match) {
  if (!match) return null;
  let n = Number(String(match[1]).replace(/,/g, ''));
  const unit = match[2] ? match[2].toLowerCase() : '';
  if (unit === 'k' || unit === 'thousand') n *= 1000;
  else if (unit === 'hundred') n *= 100;
  else if (unit === 'lakh') n *= 100000;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

// Upper-bound (maxPrice) phrasings.
const MAX_WORD_FIRST = new RegExp(
  String.raw`\b(?:under|below|less than|lesser than|within|up\s?to|upto|max(?:imum)?|no more than|at most|cheaper than|budget(?:\s+of)?)\b\s*` + AMOUNT,
  'i'
);
const MAX_NUM_FIRST = new RegExp(
  AMOUNT + String.raw`\s*(?:ke\s+(?:andar|neeche|niche|under|kam)|se\s+(?:kam|neeche|niche|sasta|low|niiche)|tak|(?:or|ya)\s+less|se\s+kam\s+ka|ke\s+budget)\b`,
  'i'
);
// Lower-bound (minPrice) phrasings.
const MIN_WORD_FIRST = new RegExp(
  String.raw`\b(?:above|over|more than|greater than|at\s?least|min(?:imum)?|starting\s+(?:from|at))\b\s*` + AMOUNT,
  'i'
);
const MIN_NUM_FIRST = new RegExp(
  AMOUNT + String.raw`\s*(?:se\s+(?:upar|uper|zyada|jyada|jada|adhik|above|more)|(?:and|ya)\s+above|\s?\+)\b`,
  'i'
);

/**
 * Extract { minPrice, maxPrice } from free text. Understands English and Hinglish
 * budget phrasings. Returns nulls when nothing is found. Never throws.
 */
export function parseBudget(text) {
  const t = String(text || '');
  const maxPrice = toAmount(MAX_WORD_FIRST.exec(t)) ?? toAmount(MAX_NUM_FIRST.exec(t));
  const minPrice = toAmount(MIN_WORD_FIRST.exec(t)) ?? toAmount(MIN_NUM_FIRST.exec(t));
  return { minPrice: minPrice ?? null, maxPrice: maxPrice ?? null };
}

// ── Keyword extraction + synonym expansion ──────────────────────────────────
/** Tokenise, drop stopwords + bare numbers, keep meaningful product words. */
export function extractKeywords(text) {
  return norm(text)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w) && !/^[0-9]+$/.test(w));
}

/** Expand keywords with their synonym group so one word matches many descriptions. */
export function expandTerms(tokens) {
  const out = new Set();
  for (const t of tokens || []) {
    out.add(t);
    // Look the token up directly, then fall back to a naive singular so a plural
    // query word ("phones", "laptops") still resolves to its synonym group.
    let group = SYNONYM_INDEX.get(t);
    if (!group && t.endsWith('es')) group = SYNONYM_INDEX.get(t.slice(0, -2));
    if (!group && t.endsWith('s')) group = SYNONYM_INDEX.get(t.slice(0, -1));
    if (group) for (const g of group) out.add(g);
  }
  return [...out];
}

/**
 * Turn a raw query + optional explicit price bounds into a search spec.
 * Explicit bounds (e.g. from the website's Min/Max inputs) win over anything
 * parsed from the text.
 * @returns {{ keywords: string[], minPrice: number|null, maxPrice: number|null }}
 */
export function buildSearchSpec(rawQuery, { explicitMin, explicitMax } = {}) {
  const text = String(rawQuery || '');
  const budget = parseBudget(text);
  const num = (v) => (v !== undefined && v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
  return {
    keywords: expandTerms(extractKeywords(text)),
    minPrice: num(explicitMin) ?? budget.minPrice,
    maxPrice: num(explicitMax) ?? budget.maxPrice,
  };
}

// ── Scoring / ranking (shared by website + AI search) ───────────────────────
const wordsOf = (s) => norm(s).split(/[^a-z0-9]+/).filter(Boolean);
// Match a query token to a product word allowing simple singular/plural variants
// only — so "phone" does NOT match "headphones" (a substring would), while
// "headphone" still matches "headphones" and "phones" still matches "phone".
const wordMatches = (word, token) =>
  word === token || word === `${token}s` || word === `${token}es` || token === `${word}s` || token === `${word}es`;

/** Field-weighted keyword score for one product against the spec keywords. */
export function scoreProductForSpec(product, keywords) {
  if (!product) return 0;
  const fields = {
    name: 5, brand: 4, category: 3, subcategory: 3, tags: 3, features: 2, description: 1,
  };
  const wordSets = {
    name: wordsOf(product.name),
    brand: wordsOf(product.brand),
    category: wordsOf(product.category),
    subcategory: wordsOf(product.subcategory),
    tags: wordsOf((product.tags || []).join(' ')),
    features: wordsOf((product.features || []).join(' ')),
    description: wordsOf(product.description),
  };
  let score = 0;
  for (const t of keywords) {
    for (const [field, weight] of Object.entries(fields)) {
      if (wordSets[field].some((w) => wordMatches(w, t))) score += weight;
    }
  }
  return score;
}

const withinBudget = (p, spec) => {
  if (spec.maxPrice != null && Number(p.price) > spec.maxPrice) return false;
  if (spec.minPrice != null && Number(p.price) < spec.minPrice) return false;
  return true;
};

/**
 * Rank REAL products against a spec.
 *  • When there are keywords: keep only genuine keyword matches, order by score
 *    (rating as a light tiebreak), and SOFT-prefer within-budget items first so
 *    a budget query never returns an empty list when only over-budget items match
 *    (honest: the caller can note "slightly over budget").
 *  • When there are no keywords: fall back to top-rated in-stock, budget-preferred.
 * Returns the input product objects (unchanged) — the caller maps them to its own
 * safe shape. Never mutates inputs, never invents rows.
 */
export function rankProductsForSpec(products, spec, { limit = 6, requireInStock = false } = {}) {
  const list = (Array.isArray(products) ? products : []).filter(Boolean);
  const pool = requireInStock ? list.filter((p) => Number(p.inventory) > 0) : list;

  if (!spec || !spec.keywords || spec.keywords.length === 0) {
    const byRating = [...pool].sort((a, b) => (b.rating || 0) - (a.rating || 0));
    const inStockFirst = [...byRating].sort((a, b) => (Number(b.inventory) > 0) - (Number(a.inventory) > 0));
    const within = inStockFirst.filter((p) => withinBudget(p, spec || {}));
    const over = inStockFirst.filter((p) => !withinBudget(p, spec || {}));
    return [...within, ...over].slice(0, limit);
  }

  const scored = pool
    .map((p) => ({ p, score: scoreProductForSpec(p, spec.keywords) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || (b.p.rating || 0) - (a.p.rating || 0));

  const within = scored.filter((s) => withinBudget(s.p, spec)).map((s) => s.p);
  const over = scored.filter((s) => !withinBudget(s.p, spec)).map((s) => s.p);
  return [...within, ...over].slice(0, limit);
}

/** Escape a keyword for safe use inside a MongoDB $regex. */
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Build a MongoDB $or clause matching the spec keywords across the searchable
 * fields. Returns null when there are no keywords (caller should skip text
 * filtering). Used by the website controller so its candidate set matches the
 * same synonyms the AI search uses.
 */
export function keywordMongoFilter(spec) {
  const kws = spec?.keywords || [];
  if (!kws.length) return null;
  const rx = kws.map((k) => new RegExp(escapeRegex(k), 'i'));
  return {
    $or: [
      { name: { $in: rx } },
      { brand: { $in: rx } },
      { category: { $in: rx } },
      { subcategory: { $in: rx } },
      { tags: { $in: rx } },
      { features: { $in: rx } },
      { description: { $in: rx } },
    ],
  };
}

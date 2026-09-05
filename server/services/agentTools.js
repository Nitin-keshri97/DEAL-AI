// ─────────────────────────────────────────────────────────────────────────
// agentTools.js — PURE agent tool logic (no Mongo, no Gemini, no I/O).
//
// Every function takes plain product/cart data as input and returns plain data.
// This keeps the agent's "brains" fully unit-testable (see agent.test.js) and
// guarantees the guardrails below hold regardless of what the LLM asks for.
//
// SECURITY: these helpers NEVER emit costPrice or other internal fields — every
// product that leaves this module is passed through toPublic() first. Prices and
// product identities always come from the caller-supplied catalogue (ultimately
// MongoDB), NEVER from AI-supplied values.
// ─────────────────────────────────────────────────────────────────────────

import { buildSearchSpec, rankProductsForSpec } from '../utils/searchQuery.js';

export const MAX_CART_QTY = 10; // hard cap on any single line quantity

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been',
  'it', 'its', 'this', 'that', 'these', 'those', 'to', 'of', 'in', 'on', 'for',
  'with', 'at', 'by', 'from', 'as', 'i', 'me', 'my', 'you', 'your', 'they', 'them',
  'so', 'very', 'really', 'just', 'not', 'no', 'too', 'about', 'after', 'once',
  'them', 'then', 'than', 'has', 'have', 'had', 'do', 'does', 'did', 'if', 'up',
]);

/** Return only customer-safe product fields — never costPrice/internal data. */
export function toPublic(p) {
  if (!p || typeof p !== 'object') return null;
  return {
    sku: p.sku,
    name: p.name,
    brand: p.brand,
    category: p.category,
    price: p.price,
    originalPrice: p.originalPrice,
    image: p.image,
    rating: p.rating,
    reviewCount: p.reviewCount,
    inventory: p.inventory,
    inStock: Number(p.inventory) > 0,
    description: p.description,
    features: Array.isArray(p.features) ? p.features : [],
    // Variant options (real catalogue values) so the agent can offer/validate a
    // colour/size choice — never fabricated, empty arrays when the item has none.
    colors: Array.isArray(p.colors) ? p.colors : [],
    sizes: Array.isArray(p.sizes) ? p.sizes : [],
  };
}

const norm = (s) => String(s ?? '').toLowerCase().trim();
const tokens = (s) => norm(s).split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOPWORDS.has(w));
const sku = (p) => Number(p?.sku);

// ── Search ──────────────────────────────────────────────────────────────────
/**
 * Rank catalogue products against a free-text query, delegating ALL parsing to
 * the shared searchQuery brain so the AI agent and the website search agree on
 * the same real MongoDB data (budgets, Hinglish, synonyms). Optional
 * minPrice/maxPrice (e.g. a remembered session budget) win over anything parsed
 * from the text. Returns public products only — never costPrice. Never invents.
 */
export function searchProductsIn(products, query, { limit = 6, minPrice, maxPrice } = {}) {
  const list = Array.isArray(products) ? products : [];
  const spec = buildSearchSpec(query, { explicitMin: minPrice, explicitMax: maxPrice });
  // With no meaningful keywords, mirror the old behaviour: top-rated IN STOCK.
  const requireInStock = spec.keywords.length === 0;
  return rankProductsForSpec(list, spec, { limit, requireInStock }).map(toPublic);
}

// ── Relationships ─────────────────────────────────────────────────────────
/** Same category, different product. */
export function getRelatedIn(products, product, { limit = 4 } = {}) {
  const list = Array.isArray(products) ? products : [];
  if (!product) return [];
  return list
    .filter((p) => sku(p) !== sku(product) && norm(p.category) === norm(product.category))
    .sort((a, b) => (b.rating || 0) - (a.rating || 0))
    .slice(0, limit)
    .map(toPublic);
}

/** Same brand, different product. */
export function getSameBrandIn(products, product, { limit = 4 } = {}) {
  const list = Array.isArray(products) ? products : [];
  if (!product || !product.brand) return [];
  return list
    .filter((p) => sku(p) !== sku(product) && norm(p.brand) === norm(product.brand))
    .sort((a, b) => (b.rating || 0) - (a.rating || 0))
    .slice(0, limit)
    .map(toPublic);
}

/** Side-by-side comparison of the given skus. */
export function compareIn(products, ids) {
  const list = Array.isArray(products) ? products : [];
  const want = (Array.isArray(ids) ? ids : []).map(Number);
  const picked = want
    .map((id) => list.find((p) => sku(p) === id))
    .filter(Boolean)
    .map(toPublic);
  return picked;
}

// ── Recommendation (MULTI-SIGNAL — not purely highest rating) ───────────────
const REC_WEIGHTS = {
  rating: 0.34, // quality
  volume: 0.2, // popularity / confidence in the rating
  value: 0.18, // discount depth vs original price
  stock: 0.1, // availability (healthy stock ranks above nearly-out)
  affinity: 0.18, // fit with what's already in the cart (brand/category)
};

/**
 * Score products using several signals so a slightly lower-rated but far more
 * popular / better-value / cart-relevant product can win. Returns public
 * products annotated with a numeric `score` and human `reasons`.
 */
export function scoreRecommendations(products, { cartLines = [], budget = null, category = null, limit = 4 } = {}) {
  const list = Array.isArray(products) ? products : [];
  const cartSkus = new Set((cartLines || []).map((l) => Number(l.sku ?? l.productId)));
  const cartBrands = new Set((cartLines || []).map((l) => norm(l.brand)).filter(Boolean));
  const cartCats = new Set((cartLines || []).map((l) => norm(l.category)).filter(Boolean));

  const pool = category ? list.filter((p) => norm(p.category) === norm(category)) : list;

  const scored = pool
    .filter((p) => !cartSkus.has(sku(p))) // don't recommend what's already in the cart
    .map((p) => {
      const ratingScore = Math.max(0, Math.min(1, (p.rating || 0) / 5));
      const volumeScore = Math.max(0, Math.min(1, (p.reviewCount || 0) / 500));
      const inv = Number(p.inventory) || 0;
      const stockScore = inv <= 0 ? 0 : inv > 50 ? 1 : inv > 15 ? 0.6 : 0.3;
      const value =
        p.originalPrice && p.originalPrice > 0
          ? Math.max(0, (p.originalPrice - p.price) / p.originalPrice)
          : 0;
      const valueScore = Math.max(0, Math.min(1, value / 0.3)); // 30% off ≈ full marks
      let affinityScore = 0;
      if (cartBrands.has(norm(p.brand))) affinityScore += 0.6;
      if (cartCats.has(norm(p.category))) affinityScore += 0.4;
      affinityScore = Math.min(1, affinityScore);

      let score =
        REC_WEIGHTS.rating * ratingScore +
        REC_WEIGHTS.volume * volumeScore +
        REC_WEIGHTS.value * valueScore +
        REC_WEIGHTS.stock * stockScore +
        REC_WEIGHTS.affinity * affinityScore;

      // Budget fit: gently penalise items over budget (never hard-exclude).
      if (budget && Number(budget) > 0 && p.price > Number(budget)) {
        score *= 0.6;
      }

      const reasons = [];
      if (ratingScore >= 0.9) reasons.push(`highly rated (${p.rating}★)`);
      else if (ratingScore >= 0.8) reasons.push(`well rated (${p.rating}★)`);
      if (volumeScore >= 0.4) reasons.push(`popular (${p.reviewCount}+ reviews)`);
      if (valueScore >= 0.5) reasons.push(`good value (${Math.round(value * 100)}% off)`);
      if (affinityScore > 0) reasons.push('pairs with your cart');
      if (stockScore < 0.6 && inv > 0) reasons.push('limited stock');
      if (inv <= 0) reasons.push('out of stock');

      return { ...toPublic(p), score: Math.round(score * 1000) / 1000, reasons };
    });

  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

// ── Bundle detection & opportunities ────────────────────────────────────────
/** Describe the cart as a bundle (2+ distinct products). */
export function detectBundle(cartLines, { bundleDiscountEnabled = true } = {}) {
  const lines = Array.isArray(cartLines) ? cartLines : [];
  const distinctCount = lines.length;
  const totalUnits = lines.reduce((s, l) => s + (Number(l.quantity) || 1), 0);
  const isBundle = distinctCount >= 2;
  const categories = [...new Set(lines.map((l) => l.category).filter(Boolean))];
  return {
    isBundle,
    distinctCount,
    totalUnits,
    categories,
    bundleDiscountEnabled: Boolean(bundleDiscountEnabled),
    // A bundle only unlocks negotiation leverage when the merchant enables it.
    dealEligible: isBundle && Boolean(bundleDiscountEnabled),
  };
}

/**
 * Suggest complementary products for the current cart: same-brand or
 * same-category items not already in the cart, ranked by affinity + quality.
 */
export function findBundleOpportunities(products, cartLines, { limit = 4 } = {}) {
  const lines = Array.isArray(cartLines) ? cartLines : [];
  if (lines.length === 0) return [];
  const recs = scoreRecommendations(products, { cartLines: lines, limit: limit * 2 });
  // Only surface items that actually relate to the cart (affinity signal fired).
  const related = recs.filter((r) => (r.reasons || []).includes('pairs with your cart'));
  const pool = related.length ? related : recs;
  return pool.slice(0, limit);
}

// ── Accessory suggestions (PART 5 — "missing accessories" for cart analysis) ──
// Maps a product TYPE (derived from its subcategory / category / name tokens) to
// concrete accessory keywords. findAccessoriesFor then finds REAL catalogue items
// matching those keywords — it never invents an accessory that isn't in stock.
const ACCESSORY_MAP = {
  laptop: ['bag', 'backpack', 'sleeve', 'mouse', 'keyboard', 'charger', 'headphone', 'headset', 'hub', 'adapter'],
  notebook: ['bag', 'backpack', 'sleeve', 'mouse', 'keyboard'],
  ultrabook: ['bag', 'sleeve', 'mouse', 'keyboard'],
  macbook: ['sleeve', 'hub', 'adapter', 'mouse'],
  smartphone: ['earbud', 'earphone', 'headphone', 'case', 'cover', 'charger'],
  phone: ['earbud', 'earphone', 'headphone', 'case', 'cover', 'charger'],
  mobile: ['earbud', 'case', 'cover', 'charger'],
  tablet: ['case', 'cover', 'stylus', 'keyboard'],
  headphone: ['case', 'stand', 'cable', 'adapter'],
  earbud: ['case', 'charger'],
  camera: ['bag', 'tripod', 'lens', 'card'],
  watch: ['strap', 'band', 'charger'],
  smartwatch: ['strap', 'band', 'charger'],
  wearable: ['strap', 'band'],
  shoe: ['socks', 'laces', 'insole'],
  sneaker: ['socks', 'laces'],
  footwear: ['socks'],
  tv: ['soundbar', 'speaker', 'mount', 'cable'],
  television: ['soundbar', 'mount', 'cable'],
  monitor: ['cable', 'mount', 'keyboard', 'mouse'],
};
const ACC_STOP = new Set(['electronics', 'the', 'and', 'with', 'for', 'pro', 'max', 'plus', 'lite', '5g', '4g', 'new']);
const accStem = (w) => (w.endsWith('es') ? w.slice(0, -2) : w.endsWith('s') ? w.slice(0, -1) : w);

/** Type tokens describing what a product IS (from subcategory/category/name). */
function typeTokensOf(product) {
  const src = [product?.subcategory, product?.category, product?.name].map(norm).join(' ');
  return src.split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !ACC_STOP.has(w));
}

/**
 * Suggest REAL accessories that complete the cart's items (e.g. a bag/mouse for a
 * laptop, earbuds/case for a phone). Ranked with the shared search brain so the
 * matches are precise; excludes anything already in the cart. Returns public
 * products (never costPrice) and [] when nothing relevant is in the catalogue.
 */
export function findAccessoriesFor(products, cartLines, { limit = 4 } = {}) {
  const list = Array.isArray(products) ? products : [];
  const lines = Array.isArray(cartLines) ? cartLines : [];
  if (!lines.length) return [];
  const cartSkus = new Set(lines.map((l) => Number(l.sku ?? l.productId)));
  const kw = new Set();
  for (const l of lines) {
    for (const tok of typeTokensOf(l)) {
      const acc = ACCESSORY_MAP[tok] || ACCESSORY_MAP[accStem(tok)];
      if (acc) acc.forEach((a) => kw.add(a));
    }
  }
  if (!kw.size) return [];
  const ranked = rankProductsForSpec(
    list,
    { keywords: [...kw], minPrice: null, maxPrice: null },
    { limit: limit + cartSkus.size + 4 }
  );
  return ranked.filter((p) => !cartSkus.has(Number(p.sku))).slice(0, limit).map(toPublic);
}

// ── Review analysis (deterministic; never invents) ──────────────────────────
function topThemes(reviewsSubset, n = 3) {
  const freq = new Map();
  for (const r of reviewsSubset) {
    const words = new Set([...tokens(r.title), ...tokens(r.comment)]);
    for (const w of words) freq.set(w, (freq.get(w) || 0) + 1);
  }
  return [...freq.entries()]
    .filter(([, c]) => c >= 2) // needs to appear in 2+ reviews to be a "theme"
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([w]) => w);
}

/**
 * Deterministic review summary. Distinguishes AVERAGE RATING, VOLUME, and
 * POSITIVE vs NEGATIVE themes. Returns { available:false } gracefully when there
 * is nothing to summarise. Never fabricates content.
 */
export function summarizeReviews(reviews, reviewCount) {
  const list = Array.isArray(reviews) ? reviews.filter((r) => r && typeof r === 'object') : [];
  const displayCount = Number(reviewCount) || list.length;

  if (list.length === 0) {
    return { available: false, count: displayCount, text: 'Not enough reviews yet to summarize.' };
  }

  const ratings = list.map((r) => Number(r.rating)).filter((n) => Number.isFinite(n));
  const avg = ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : null;

  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const r of ratings) {
    const k = Math.max(1, Math.min(5, Math.round(r)));
    distribution[k] += 1;
  }

  const positive = list.filter((r) => Number(r.rating) >= 4);
  const negative = list.filter((r) => Number(r.rating) <= 3);
  const verifiedCount = list.filter((r) => r.verified).length;

  const positiveThemes = topThemes(positive);
  const negativeThemes = topThemes(negative);

  // Build a factual sentence from the numbers only.
  const parts = [];
  if (avg != null) {
    parts.push(`Averages ${avg}★ across ${displayCount} review${displayCount === 1 ? '' : 's'}`);
  }
  const posPct = Math.round((positive.length / list.length) * 100);
  parts.push(`${posPct}% of sampled reviews are positive (4★+)`);
  if (positiveThemes.length) parts.push(`praised for: ${positiveThemes.join(', ')}`);
  if (negativeThemes.length) parts.push(`some note: ${negativeThemes.join(', ')}`);

  return {
    available: true,
    count: displayCount,
    sampled: list.length,
    average: avg,
    distribution,
    positiveCount: positive.length,
    negativeCount: negative.length,
    verifiedCount,
    positiveThemes,
    negativeThemes,
    text: parts.join('; ') + '.',
  };
}

// ── Intent parsing (for the deterministic fallback agent) ───────────────────
/**
 * Map a free-text message to a coarse intent + residual query. Pure string
 * logic — the caller resolves any product names against the live catalogue.
 */
export function parseIntent(message) {
  const m = norm(message);
  const stripAction = (re) => message.replace(re, ' ').replace(/\s+/g, ' ').trim();

  if (
    /\b(clear|empty|reset)\b.*\bcart\b/.test(m) ||
    /\bempty my cart\b/.test(m) ||
    /\bcart\b[^?]*\b(khali|khaali|saaf)\b/.test(m) ||
    /\b(khali|khaali|saaf)\s+kar\b[^?]*\bcart\b/.test(m)
  ) {
    return { intent: 'clear_cart', query: '' };
  }
  // Analyze the current cart for complementary / missing items (PART 5). Requires
  // an explicit "analy(s/z)e" so "review my cart" stays a CHECKOUT phrasing and is
  // never captured here. Works for Hinglish too ("mere cart ko analyze karo").
  if (/\banaly[sz]e?/.test(m)) {
    return { intent: 'analyze_cart', query: '' };
  }
  // Order history / a specific past order (PART 14). Must come BEFORE add/search/
  // checkout so phrasings containing "order"/"buy" aren't misrouted. These read
  // the customer's OWN orders only (the agent tool enforces auth + ownership).
  if (
    /\border\s+(details?|status)\b/.test(m) ||
    /\b(track|status of)\b[^?]*\border\b/.test(m) ||
    /\b(my|the)\s+(last|latest|recent|most recent)\s+order\b/.test(m) ||
    /\bdetails?\b[^?]*\border\b/.test(m)
  ) {
    return { intent: 'order_details', query: stripAction(/\b(show|me|the|my|details?|of|for|on|please|order|status|track|last|latest|recent|most)\b/gi) };
  }
  if (
    /\bmy orders\b/.test(m) ||
    /\border history\b/.test(m) ||
    /\bpurchase history\b/.test(m) ||
    /\b(past|previous|recent)\s+(orders?|purchases?)\b/.test(m) ||
    /\bwhat did i (order|buy|purchase)\b/.test(m) ||
    /\bdid i (order|buy|purchase)\b/.test(m) ||
    /\bhave i (ordered|bought|purchased)\b/.test(m) ||
    /\borders? i('?ve| have)\s+(made|placed)\b/.test(m)
  ) {
    return { intent: 'my_orders', query: '' };
  }
  // Update a cart line's quantity ("make it 2", "quantity 2", "set to 3",
  // "2 kar do"). Requires an explicit number so it never swallows other commands,
  // and sits BEFORE remove/add so a quantity change is not mis-routed.
  {
    const qtyM =
      m.match(/\b(?:quantity|qty)\b[^0-9]{0,12}(\d+)/) ||
      m.match(/\bmake it\s+(\d+)\b/) ||
      m.match(/\bset\s+(?:it\s+|the\s+quantity\s+|quantity\s+)?to\s+(\d+)\b/) ||
      m.match(/\bchange\b[^0-9]{0,24}\bto\s+(\d+)\b/) ||
      m.match(/\b(\d+)\s*(?:kar\s?do|kardo|kar\s?dena|kardena)\b/);
    if (qtyM) {
      const quantity = Number(qtyM[1]);
      if (Number.isInteger(quantity) && quantity >= 0 && quantity <= 999) {
        return {
          intent: 'update_qty',
          quantity,
          query: stripAction(/\b(quantity|qty|make|set|it|the|to|change|please|kar\s?do|kardo|kar\s?dena|kardena|ki|ka)\b/gi),
        };
      }
    }
  }
  if (/\b(remove|delete|take out|drop|hata\s?do|hatao|hata\s?de|hata\s?dena|nikaal\s?do|nikaalo|nikalo|nikaal\s?de)\b/.test(m)) {
    return { intent: 'remove', query: stripAction(/\b(remove|delete|take out|drop|from|cart|the|se|ko|hata\s?do|hatao|hata\s?de|hata\s?dena|nikaal\s?do|nikaalo|nikalo|nikaal\s?de)\b/gi) };
  }
  // Checkout preparation — must come BEFORE `add` because phrases like
  // "ready to buy" / "proceed to checkout" contain add-words but are not adds.
  if (
    /\b(checkout|check out|prepare|proceed|place (my )?order|ready to (buy|pay|checkout)|complete (my )?(order|purchase))\b/.test(m) ||
    /\b(prepare|review).*\b(cart|order|checkout)\b/.test(m) ||
    /\b(checkout|order)\s+kar\s?(do|lo|dena)\b/.test(m) ||
    /\bkhareed(o|na|lo|do)\b/.test(m) ||
    /\bpayment\s+kar\s?(o|do|lo)\b/.test(m)
  ) {
    return { intent: 'checkout', query: '' };
  }
  // Autonomous selection — the customer DELEGATES the choice to the agent and
  // wants it added ("you decide and add the best for my cart", "pick the best
  // one for me", "surprise me"). This must PROPOSE + await confirmation
  // (PART 5 / PART 10), so it is its own intent — placed BEFORE `add` (which
  // would swallow the "add" verb) and before `recommend` (which only describes).
  // Never trigger on a negotiation phrasing ("best deal").
  if (
    !/\b(deal|negotiate|discount|bargain|cheaper|lower price|better price)\b/.test(m) &&
    (
      (/\byou\s+(decide|choose|pick|select)\b/.test(m) && /\b(add|buy|get|grab|take|put|cart)\b/.test(m)) ||
      /\b(decide|choose|pick|select)\s+(one\s+)?for (me|my cart)\b/.test(m) ||
      /\b(add|get me|grab|choose|pick|select)\b[^.?!]*\bbest\b[^.?!]*\b(for me|for my cart|one|option|product|item)\b/.test(m) ||
      /\bsurprise me\b/.test(m) ||
      /\b(add|pick|choose|decide|select)\b[^.?!]*\byourself\b/.test(m) ||
      /\bwhatever you (think|want|recommend|like)\b/.test(m) ||
      // Hinglish delegation: "tum decide karo", "best wala choose karo",
      // "tum hi decide kar do", "jo best ho wo pick karo".
      /\b(tum|tu|aap)\s+(hi\s+)?(decide|choose|pick|select|dekh)\b/.test(m) ||
      /\bbest\s?wala\b/.test(m) ||
      /\btum\s+decide\b/.test(m)
    )
  ) {
    return { intent: 'autopick', query: '' };
  }
  // "get me the best deal" / "buy me a discount" mention an add-word but really
  // want negotiation — don't let the add branch swallow them.
  if (
    (
      /\b(add|put|buy|get me|i(?:'| a)?ll take|include)\b/.test(m) ||
      /\b(daal\s?do|daalo|daal\s?dena|daaldo|add\s+kar\s?do|add\s?karo|add\s?kardo|le\s?lo)\b/.test(m)
    ) &&
    !/\?$/.test(m) &&
    !/\b(best deal|deal|negotiate|discount|bargain)\b/.test(m)
  ) {
    return {
      intent: 'add',
      query: stripAction(/\b(add|put|buy|get me|please|to cart|cart|the|a|an|me|mein|mai|daal\s?do|daalo|daal\s?dena|daaldo|kar\s?do|karo|kardo|le\s?lo|ko|isko|ise|iske|ye|yeh|is|this|it|bhi|wo|woh|us|usko)\b/gi),
    };
  }
  // "Deal accept karo" / "accept the deal" / "lock it in" — CONFIRM the price
  // the customer already negotiated (PART 9). Checked BEFORE `negotiate` (which
  // greedily matches the word "deal"), so accepting never re-opens negotiation.
  if (
    /\b(deal|offer|discount|price)\b/.test(m) &&
    /\b(accept|confirm|apply|finalize|finalise|final|lock\s?in|manzoor|pakka|laga\s?do|lagao)\b/.test(m)
  ) {
    return { intent: 'accept_deal', query: '' };
  }
  if (/\b(best deal|negotiate|discount|cheaper|lower price|better price|deal|bargain)\b/.test(m)) {
    return { intent: 'negotiate', query: '' };
  }
  if (/\b(compare|versus|vs\.?|difference between)\b/.test(m)) {
    return { intent: 'compare', query: stripAction(/\b(compare|versus|vs\.?|and|the|difference between)\b/gi) };
  }
  if (/\b(review|reviews|rated|rating|worth it|any good|is it good)\b/.test(m)) {
    return { intent: 'reviews', query: stripAction(/\b(review|reviews|of|for|the|about|rating|rated)\b/gi) };
  }
  if (/\b(bundle|goes with|go with|pair|pairs|combo|together|complete the|matches)\b/.test(m)) {
    return { intent: 'bundle', query: '' };
  }
  if (/\b(recommend|suggest|which one|you decide|you choose|you pick|best one|help me choose|what should|pick for me)\b/.test(m)) {
    return { intent: 'recommend', query: stripAction(/\b(recommend|suggest|me|a|an|the|some|please|for)\b/gi) };
  }
  if (/\b(cart|what.?s in my cart|show.*cart|my cart)\b/.test(m)) {
    return { intent: 'view_cart', query: '' };
  }
  if (/\b(show|find|search|looking for|do you have|need|want|got any|any)\b/.test(m)) {
    return { intent: 'search', query: stripAction(/\b(show|me|find|search|for|looking|i'm|im|do you have|any|got|need|a|an|the|please|want)\b/gi) };
  }
  // Default: treat as a product search using the whole message.
  return { intent: 'search', query: message };
}

// ── Server-side cart-op validation (guardrail) ──────────────────────────────
/**
 * Validate a proposed cart mutation against the real catalogue. The PRICE always
 * comes from the matched product (DB), never from the caller/AI. Returns a
 * normalised action or a safe error — the ONLY way a cart change is allowed.
 */
export function validateCartOp({ products, op, productId, quantity }) {
  const VALID = ['add', 'remove', 'update', 'clear'];
  if (!VALID.includes(op)) return { valid: false, error: `Unsupported cart operation: ${op}` };

  if (op === 'clear') {
    return { valid: true, action: { op: 'clear' } };
  }

  const list = Array.isArray(products) ? products : [];
  const id = Number(productId);
  if (!Number.isFinite(id)) return { valid: false, error: 'A valid product id is required.' };
  const product = list.find((p) => Number(p.sku) === id);
  if (!product) return { valid: false, error: 'That product could not be found.' };

  if (op === 'remove') {
    return { valid: true, action: { op: 'remove', productId: Number(product.sku), name: product.name } };
  }

  // add / update need a quantity.
  let qty;
  if (op === 'add') {
    qty = quantity === undefined || quantity === null ? 1 : Number(quantity);
  } else {
    qty = Number(quantity);
  }
  if (!Number.isInteger(qty)) return { valid: false, error: 'Quantity must be a whole number.' };
  if (qty < 1) return { valid: false, error: 'Quantity must be at least 1.' };
  if (qty > MAX_CART_QTY) return { valid: false, error: `Quantity cannot exceed ${MAX_CART_QTY}.` };

  return {
    valid: true,
    action: {
      op,
      productId: Number(product.sku),
      name: product.name,
      quantity: qty,
      price: product.price, // trusted price from the catalogue — never from AI
    },
  };
}

// ── Variant selection (PART 2 — select_product_variant, real values only) ─────
/**
 * Resolve a colour/size choice against a product's REAL variant options. Pure and
 * honest: it validates the requested value against the product's actual
 * colors/sizes arrays (never fabricates a variant, never guesses). Returns:
 *   • { status: 'error', ... }         product missing
 *   • { status: 'needs_selection', ... } the product HAS options but the caller
 *       supplied none (or an invalid one) — includes the options to offer + which
 *       value was rejected, so the agent can ASK the user (PART 8 safety).
 *   • { status: 'ok', selection: { color?, size? } } a clean, validated choice
 *       (also 'ok' with an empty selection when the product has no variants).
 */
export function resolveVariantSelection(product, { color, size } = {}) {
  if (!product || typeof product !== 'object') {
    return { status: 'error', error: 'That product could not be found.' };
  }
  const colors = Array.isArray(product.colors) ? product.colors : [];
  const sizes = Array.isArray(product.sizes) ? product.sizes : [];
  const hasColors = colors.length > 0;
  const hasSizes = sizes.length > 0;

  // Case-insensitive match that returns the catalogue's canonical spelling.
  const pick = (options, want) => {
    if (want === undefined || want === null || String(want).trim() === '') return undefined;
    return options.find((o) => norm(o) === norm(want)) ?? null; // null = supplied but invalid
  };

  const selection = {};
  const missing = [];
  const invalid = [];

  if (hasColors) {
    const chosen = pick(colors, color);
    if (chosen === undefined) missing.push('color');
    else if (chosen === null) invalid.push('color');
    else selection.color = chosen;
  }
  if (hasSizes) {
    const chosen = pick(sizes, size);
    if (chosen === undefined) missing.push('size');
    else if (chosen === null) invalid.push('size');
    else selection.size = chosen;
  }

  if (missing.length || invalid.length) {
    return {
      status: 'needs_selection',
      productId: Number(product.sku),
      name: product.name,
      needs: [...new Set([...missing, ...invalid])],
      invalid,
      options: {
        ...(hasColors ? { colors } : {}),
        ...(hasSizes ? { sizes } : {}),
      },
    };
  }

  return { status: 'ok', productId: Number(product.sku), name: product.name, selection };
}

// ── Checkout preparation (PART 15 — no real payment) ────────────────────────
/**
 * Build a customer-safe checkout summary from resolved cart lines. PURE: takes
 * only safe fields (never costPrice) and returns plain data.
 *
 * A previously-negotiated price is applied ONLY when it still matches the exact
 * current cart total (`lastNegotiation.originalPrice === subtotal`) and was not a
 * REJECT — so we never show a stale or unearned discount (honest, PART 27). All
 * prices originate from the trusted catalogue lines, never from AI output.
 *
 * @param {Array} lines  [{ sku, name, price, originalPrice, quantity, inventory }]
 * @param {{ lastNegotiation?: object }} opts
 */
export function buildCheckoutSummary(lines, { lastNegotiation = null } = {}) {
  const list = Array.isArray(lines) ? lines.filter((l) => l && typeof l === 'object') : [];

  if (list.length === 0) {
    return {
      ready: false,
      empty: true,
      itemCount: 0,
      items: [],
      subtotal: 0,
      originalTotal: 0,
      catalogueSavings: 0,
      negotiatedSavings: 0,
      finalTotal: 0,
      issues: [],
    };
  }

  const items = [];
  const issues = [];
  let subtotal = 0;
  let originalTotal = 0;

  for (const l of list) {
    const qty = Math.max(0, Math.floor(Number(l.quantity) || 0));
    const price = Number(l.price) || 0;
    const orig = Number(l.originalPrice) || price;
    const inv = Number(l.inventory);
    const lineTotal = price * qty;
    subtotal += lineTotal;
    originalTotal += orig * qty;

    if (Number.isFinite(inv)) {
      if (inv <= 0) issues.push(`${l.name} is out of stock.`);
      else if (qty > inv) issues.push(`Only ${inv} of ${l.name} left (you have ${qty}).`);
    }

    items.push({
      sku: Number(l.sku),
      name: l.name,
      price,
      quantity: qty,
      lineTotal,
    });
  }

  const catalogueSavings = Math.max(0, Math.round(originalTotal - subtotal));

  // Apply the negotiated price only if it's still valid for THIS exact cart.
  let negotiatedSavings = 0;
  let finalTotal = subtotal;
  if (
    lastNegotiation &&
    lastNegotiation.decision !== 'REJECT' &&
    Number(lastNegotiation.originalPrice) === subtotal &&
    Number(lastNegotiation.finalPrice) > 0 &&
    Number(lastNegotiation.finalPrice) < subtotal
  ) {
    finalTotal = Math.round(Number(lastNegotiation.finalPrice));
    negotiatedSavings = Math.max(0, subtotal - finalTotal);
  }

  return {
    ready: issues.length === 0,
    empty: false,
    itemCount: items.reduce((s, i) => s + i.quantity, 0),
    items,
    subtotal: Math.round(subtotal),
    originalTotal: Math.round(originalTotal),
    catalogueSavings,
    negotiatedSavings,
    finalTotal,
    issues,
  };
}

// ── Order-history summary (PART 12–14 — personalization, NEVER fabricated) ────
/**
 * Summarize a customer's REAL order history into safe, factual signals the agent
 * can use to personalize: order count, spend, savings, most-recent distinct items
 * (newest first), and inferred preferred categories / brands.
 *
 * PURE and honest: it only reports what is in the passed-in orders. With no
 * history it returns { hasHistory: false } so the agent can say "not enough
 * purchase history yet" instead of inventing past purchases. Snapshots already
 * carry name/brand/category, so no catalogue join is needed. Never emits money
 * the caller didn't record, and never touches costPrice/auth data.
 *
 * @param {Array} orders  safe order objects: { items:[{productId,name,brand,category,quantity}], finalTotal, totalSavings, createdAt }
 */
export function summarizeOrderHistory(orders, { recentLimit = 8 } = {}) {
  const list = Array.isArray(orders) ? orders.filter((o) => o && typeof o === 'object') : [];
  if (list.length === 0) {
    return {
      hasHistory: false,
      orderCount: 0,
      totalSpent: 0,
      totalSaved: 0,
      recentItems: [],
      topCategories: [],
      topBrands: [],
      text: 'No previous purchases yet.',
    };
  }

  // Newest first (don't assume the caller sorted).
  const sorted = [...list].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  let totalSpent = 0;
  let totalSaved = 0;
  const catFreq = new Map();
  const brandFreq = new Map();
  const recentItems = [];
  const seenSku = new Set();
  const bump = (map, key, n) => {
    const k = String(key || '').trim();
    if (k) map.set(k, (map.get(k) || 0) + n);
  };

  for (const o of sorted) {
    totalSpent += Number(o.finalTotal) || 0;
    totalSaved += Number(o.totalSavings) || 0;
    for (const it of Array.isArray(o.items) ? o.items : []) {
      const qty = Number(it.quantity) || 1;
      bump(catFreq, it.category, qty);
      bump(brandFreq, it.brand, qty);
      const sk = Number(it.productId);
      if (Number.isFinite(sk) && !seenSku.has(sk)) {
        seenSku.add(sk);
        if (recentItems.length < recentLimit) {
          recentItems.push({
            productId: sk,
            name: it.name,
            quantity: qty,
            brand: it.brand || null,
            category: it.category || null,
          });
        }
      }
    }
  }

  const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);
  const topCategories = top(catFreq);
  const names = recentItems.slice(0, 3).map((i) => i.name);
  const parts = [`${sorted.length} previous order${sorted.length === 1 ? '' : 's'}`];
  if (names.length) parts.push(`recently bought: ${names.join(', ')}`);
  if (topCategories.length) parts.push(`favours ${topCategories.join(', ')}`);

  return {
    hasHistory: true,
    orderCount: sorted.length,
    totalSpent: Math.round(totalSpent),
    totalSaved: Math.round(totalSaved),
    recentItems,
    topCategories,
    topBrands: top(brandFreq),
    text: parts.join('; ') + '.',
  };
}

// ─────────────────────────────────────────────────────────────────────────
// agentService.js — the DealAI shopping agent: a REAL bounded multi-step
// tool-use loop over Google Gemini function-calling.
//
// The agent OBSERVES (reads cart / catalogue / reviews), REASONS, RECOMMENDS,
// and TAKES CONTROLLED ACTIONS by calling backend tools — it never replies
// with hardcoded text and never mutates anything directly. Cart tools are
// STATELESS: they validate a proposed change against the real catalogue and
// emit a `cartAction` the client applies through its existing CartContext
// (client-authoritative cart — the server keeps no cart).
//
// SECURITY / GUARDRAILS:
//   • Gemini key + Mongo URI are read only from server/.env, never logged,
//     never returned to the client.
//   • Every product that leaves here is passed through toPublic() → no
//     costPrice / internal fields.
//   • Prices/ids always come from MongoDB via validateCartOp — NEVER from AI.
//   • Negotiation runs through the shared negotiationService.runNegotiation,
//     so the merchant floors (max discount / min margin / min price / max
//     rounds) are reused and can NEVER be bypassed by the agent.
//   • On ANY Gemini problem (no key / 429 / timeout / bad output) the loop
//     falls back to a deterministic agent that still uses the real tools.
// ─────────────────────────────────────────────────────────────────────────

import { readEnv } from '../config/loadEnv.js';
import { isDbConnected } from '../config/db.js';
import Product from '../models/Product.js';
import Order from '../models/Order.js';
import User from '../models/User.js';
import MerchantSettings, { DEFAULT_SETTINGS } from '../models/MerchantSettings.js';
import { resolveLines } from './cartService.js';
import { runNegotiation } from './negotiationService.js';
import { buildPricingContext } from '../utils/calculations.js';
import { parseBudget, extractKeywords } from '../utils/searchQuery.js';
import {
  toPublic,
  searchProductsIn,
  getRelatedIn,
  getSameBrandIn,
  compareIn,
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
} from './agentTools.js';

// ── Tunables ────────────────────────────────────────────────────────────────
const MAX_AGENT_TURNS = 5; // max Gemini round-trips per user message (bounded cost)
const AGENT_TIMEOUT_MS = 15_000;
const MAX_HISTORY = 16; // conversation turns kept for context (8 exchanges)
const MAX_MESSAGE_LEN = 2000;
const MAX_PRODUCTS_OUT = 8;

// Session memory eviction.
const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2h
const MAX_SESSIONS = 500;

// Transient-failure handling for Groq (mirrors aiDealService).
const DEFAULT_MODEL = 'openai/gpt-oss-120b';
const DEFAULT_BASE_URL = 'https://api.groq.com/openai/v1';
const MAX_ATTEMPTS = 2;
const RETRY_BACKOFF_MS = 700;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Env / provider config (read from server/.env only) ──────────────────────
function getApiKey() {
  return readEnv('AI_API_KEY');
}
function getModel() {
  const m = readEnv('AI_MODEL');
  return m || DEFAULT_MODEL;
}
function getBaseUrl() {
  const b = readEnv('AI_BASE_URL');
  return b ? b.replace(/\/+$/, '') : DEFAULT_BASE_URL;
}
/** True when an AI key is present — otherwise the agent runs deterministically. */
export function isAgentAiConfigured() {
  return Boolean(getApiKey());
}

async function loadSettings() {
  const doc = await MerchantSettings.findOne().lean();
  return doc || DEFAULT_SETTINGS;
}

// ── In-memory session store (PART 16) ────────────────────────────────────────
// Ephemeral by design (documented limitation). The client also re-sends recent
// history each turn, so context survives eviction / server restarts.
const sessions = new Map();

function evictStaleSessions() {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.updatedAt > SESSION_TTL_MS) sessions.delete(id);
  }
  if (sessions.size > MAX_SESSIONS) {
    // Drop the oldest entries down to the cap.
    const sorted = [...sessions.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt);
    for (let i = 0; i < sorted.length - MAX_SESSIONS; i++) sessions.delete(sorted[i][0]);
  }
}

function getSession(sessionId) {
  evictStaleSessions();
  const id = typeof sessionId === 'string' && sessionId.trim() ? sessionId.trim().slice(0, 100) : `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  let s = sessions.get(id);
  if (!s) {
    s = {
      id,
      history: [],
      discussedIds: new Set(),
      recommendedIds: new Set(),
      selectedId: null,
      selectedVariant: null,
      budget: null,
      preferredCategory: null,
      lastNegotiation: null,
      negotiationRound: 1,
      updatedAt: Date.now(),
    };
    sessions.set(id, s);
  }
  return s;
}

function pushHistory(session, role, text) {
  const t = String(text ?? '').trim();
  if (!t) return;
  session.history.push({ role, text: t.slice(0, MAX_MESSAGE_LEN) });
  if (session.history.length > MAX_HISTORY) session.history = session.history.slice(-MAX_HISTORY);
}

/**
 * READ-ONLY peek at a session's last negotiation — WITHOUT creating a session.
 * Used by the order controller so the server (not the client) is the source of
 * truth for any negotiated price applied at checkout. Returns a shallow copy so
 * callers can't mutate session state, or null if there is none.
 */
export function peekSessionNegotiation(sessionId) {
  if (typeof sessionId !== 'string' || !sessionId.trim()) return null;
  const s = sessions.get(sessionId.trim().slice(0, 100));
  if (!s || !s.lastNegotiation) return null;
  return { ...s.lastNegotiation };
}

/**
 * Save a negotiation card to a session so that checkout and orders can apply it.
 */
export function saveSessionNegotiation(sessionId, card) {
  if (typeof sessionId !== 'string' || !sessionId.trim() || !card) return;
  const s = getSession(sessionId);
  s.lastNegotiation = card;
  s.negotiationRound = (s.negotiationRound || 1) + 1;
}

/**
 * Capture a spending ceiling from a message ("under ₹3000", "30000 ke andar",
 * "40k tak") → number, delegating to the shared searchQuery brain so the agent's
 * budget parsing matches the website search exactly (English + Hinglish).
 */
function captureBudget(message) {
  const { maxPrice } = parseBudget(message);
  return Number.isFinite(maxPrice) && maxPrice > 0 ? maxPrice : null;
}

// ── Catalogue helpers ─────────────────────────────────────────────────────
async function loadCatalogue() {
  const docs = await Product.find().sort({ sku: 1 });
  // toSafeJSON keeps reviews/features/brand (needed by review & detail tools)
  // but strips costPrice/__v. Never expose internal fields.
  return docs.map((d) => d.toSafeJSON());
}

// ── User personalization context (PART 12 — SAFE fields only) ────────────────
/**
 * Build a customer-safe personalization context from REAL data for a logged-in
 * user. Returns the user's display name, their recent orders (safe projection),
 * and a factual history summary (order count, spend, recent items, preferred
 * categories). NEVER includes email / passwordHash / token / costPrice — only
 * what is safe to place in the AI context and cite back to the customer.
 */
async function loadUserContext(userId) {
  const [user, orderDocs] = await Promise.all([
    User.findById(userId).select('name'),
    Order.find({ userId }).sort({ createdAt: -1 }).limit(20),
  ]);
  if (!user) return null;
  const orders = orderDocs.map((o) => o.toSafeJSON());
  const history = summarizeOrderHistory(orders);
  // Affinity seeds for personalized recommendations (brand/category of past buys).
  const purchasedSeeds = history.recentItems.map((i) => ({
    sku: i.productId,
    brand: i.brand,
    category: i.category,
  }));
  return { userId: String(userId), name: user.name, orders, history, purchasedSeeds };
}

/** Compact card shape for tool results sent back to the model (small payloads). */
const compactCard = (p) => ({
  sku: p.sku,
  name: p.name,
  brand: p.brand,
  category: p.category,
  price: p.price,
  originalPrice: p.originalPrice,
  rating: p.rating,
  reviewCount: p.reviewCount,
  inStock: p.inStock ?? Number(p.inventory) > 0,
});

function dedupeBySku(products) {
  const seen = new Set();
  const out = [];
  for (const p of products) {
    const k = Number(p?.sku);
    if (!Number.isFinite(k) || seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

// ── High-level activity labels (PART 12 — NO chain-of-thought) ───────────────
const ACTIVITY = {
  search: '🔎 Searched the catalogue',
  details: '📋 Looked up product details',
  reviews: '⭐ Analyzed customer reviews',
  related: '🔗 Found related products',
  brand: '🏷️ Found same-brand products',
  compare: '⚖️ Compared products',
  recommend: '✨ Ranked the best options',
  cart: '🛒 Checked your cart',
  cartUpdate: '🛒 Prepared a cart update',
  propose: '💡 Prepared a suggestion',
  bundle: '💰 Analyzed bundle opportunities',
  eligibility: '💰 Checked deal eligibility',
  negotiate: "🤝 Negotiated on the merchant's behalf",
  acceptDeal: '🤝 Deal validated & locked in',
  checkout: '🧾 Prepared checkout',
  orders: '📦 Looked up your orders',
  personalize: '🎯 Personalized to your history',
  analyze: '🧠 Analyzed your cart',
  variant: '🎨 Checked variant options',
  accessories: '🧩 Found matching accessories',
};
function recordActivity(ctx, key) {
  const label = ACTIVITY[key];
  if (label && !ctx.out.activity.includes(label)) ctx.out.activity.push(label);
}

// ── Shared negotiation runner (used by both the Gemini tool + fallback) ──────
async function doStartNegotiation(ctx, offerArg) {
  if (ctx.cartLines.length === 0) {
    return { error: 'Your cart is empty — add items before I negotiate.' };
  }
  const settings = ctx.settings;
  const cartTotal = ctx.cartTotal;

  let offer = Number(offerArg);
  if (!Number.isFinite(offer) || offer <= 0) {
    // "Get me the best deal" with no number → ask at the max-discount price and
    // let the guardrailed engine decide the real floor.
    const maxD = Number(settings.maxDiscountPercent) || 0;
    offer = Math.max(1, Math.round(cartTotal * (1 - maxD / 100)));
  }

  const round = ctx.session.negotiationRound || 1;
  const { ctx: pc, deal, usedFallback } = await runNegotiation({
    lines: ctx.cartLines,
    settings,
    offer,
    negotiationRound: round,
    customerContext: {},
  });

  // Safe card (identical shape to the /api/deals/negotiate response — no
  // costPrice / margin / floor).
  const card = {
    decision: deal.decision,
    originalPrice: pc.cartTotal,
    customerOffer: offer,
    finalPrice: deal.finalPrice,
    discountAmount: deal.discountAmount,
    discountPercent: deal.discountPercent,
    savings: deal.discountAmount,
    reason: deal.reason,
    confidence: deal.confidence,
    bundle: pc.bundle,
    usedFallback,
  };
  ctx.out.negotiation = card;
  ctx.session.lastNegotiation = card;
  ctx.session.negotiationRound = round + 1;
  recordActivity(ctx, 'negotiate');

  return {
    decision: card.decision,
    finalPrice: card.finalPrice,
    discountPercent: card.discountPercent,
    originalPrice: card.originalPrice,
    reason: card.reason,
  };
}

// ── Shared checkout-preparation runner (used by the Gemini tool + fallback) ───
// Builds trusted lines from the resolved cart + catalogue (never AI-supplied),
// reuses the last guardrailed negotiation only if it still fits this exact cart,
// and records a customer-safe summary on ctx.out. No real payment (PART 15).
function doPrepareCheckout(ctx) {
  const lines = ctx.cartPublic.map((l) => {
    const cat = ctx.bySku.get(Number(l.sku));
    return {
      sku: l.sku,
      name: l.name,
      price: l.price, // trusted catalogue price (from resolveLines)
      originalPrice: cat?.originalPrice ?? l.price,
      quantity: l.quantity,
      inventory: cat?.inventory,
    };
  });
  const summary = buildCheckoutSummary(lines, { lastNegotiation: ctx.session.lastNegotiation });
  ctx.out.checkout = summary;
  // Navigation hint (PART 18): "take me to checkout" opens the checkout view.
  if (!summary.empty) ctx.out.navigation = { type: 'checkout' };
  recordActivity(ctx, 'checkout');
  return summary;
}

// ── Shared "accept the deal" runner (used by the Gemini tool + fallback) ──────
// Explicitly confirms and locks in a price the customer already negotiated
// (PART 9). The AI NEVER sets the price: we re-validate through the
// server-authoritative checkout summary, which re-applies the negotiated price
// ONLY if it still matches THIS exact cart. Accepting confirms + surfaces the
// amount; it deliberately does NOT navigate to checkout (that's a separate,
// explicit "checkout karo" step) and NEVER takes payment.
function doAcceptDeal(ctx) {
  const n = ctx.session.lastNegotiation;
  if (!n || !['ACCEPT', 'COUNTER_OFFER'].includes(n.decision)) {
    return { accepted: false, reason: 'no_deal' };
  }
  const summary = doPrepareCheckout(ctx); // server-authoritative recompute
  ctx.out.navigation = null; // accepting locks the price; checkout is its own step
  if (summary.empty) return { accepted: false, reason: 'empty_cart' };
  recordActivity(ctx, 'acceptDeal');
  const applies = summary.negotiatedSavings > 0;
  return {
    accepted: applies,
    stale: !applies, // the deal no longer fits the current cart (graceful path)
    finalTotal: summary.finalTotal,
    itemCount: summary.itemCount,
    negotiatedSavings: summary.negotiatedSavings || 0,
    catalogueSavings: summary.catalogueSavings || 0,
    totalSavings: (summary.catalogueSavings || 0) + (summary.negotiatedSavings || 0),
  };
}

// ── Tool implementations ─────────────────────────────────────────────────────
// Each returns a COMPACT result for the model AND records side effects on
// ctx.out (products / cartActions / negotiation / pendingConfirmation).
const TOOLS = {
  // ---- PRODUCT (read-only, always safe/automatic) ----
  searchProducts(args, ctx) {
    // Budget: an explicit arg wins, else the remembered session budget (PART 1/3).
    const maxPrice = Number(args.maxPrice) > 0 ? Number(args.maxPrice) : (ctx.session.budget || undefined);
    const minPrice = Number(args.minPrice) > 0 ? Number(args.minPrice) : undefined;
    const results = searchProductsIn(ctx.catalogue, String(args.query || ''), {
      limit: clampInt(args.limit, 6, 1, MAX_PRODUCTS_OUT),
      minPrice,
      maxPrice,
    });
    results.forEach((r) => ctx.out.products.push(r));
    // Remember the top match as the "current" product so a follow-up like
    // "add it" / "isko cart mein daal do" refers to the right real product.
    if (results[0]) {
      ctx.session.selectedId = Number(results[0].sku);
      if (results[0].category) ctx.session.preferredCategory = results[0].category;
    }
    recordActivity(ctx, 'search');
    return { count: results.length, products: results.map(compactCard) };
  },

  getProductDetails(args, ctx) {
    const p = ctx.bySku.get(Number(args.productId));
    if (!p) return { error: 'Product not found.' };
    ctx.out.products.push(toPublic(p));
    ctx.session.discussedIds.add(Number(p.sku));
    ctx.session.selectedId = Number(p.sku); // "current" product for follow-up "add it"
    recordActivity(ctx, 'details');
    return {
      product: {
        sku: p.sku,
        name: p.name,
        brand: p.brand || null,
        category: p.category || null,
        price: p.price,
        originalPrice: p.originalPrice ?? null,
        rating: p.rating ?? null,
        reviewCount: p.reviewCount ?? 0,
        inStock: Number(p.inventory) > 0,
        description: p.description || null,
        features: Array.isArray(p.features) ? p.features : [],
      },
    };
  },

  getProductReviews(args, ctx) {
    const p = ctx.bySku.get(Number(args.productId));
    if (!p) return { error: 'Product not found.' };
    const summary = summarizeReviews(p.reviews, p.reviewCount);
    ctx.out.products.push(toPublic(p));
    recordActivity(ctx, 'reviews');
    return {
      product: p.name,
      rating: p.rating ?? null,
      reviewCount: p.reviewCount ?? 0,
      summary,
      sample: (Array.isArray(p.reviews) ? p.reviews : []).slice(0, 3).map((r) => ({
        rating: r.rating,
        title: r.title,
        comment: r.comment,
        verified: Boolean(r.verified),
      })),
    };
  },

  getRelatedProducts(args, ctx) {
    const p = ctx.bySku.get(Number(args.productId));
    if (!p) return { error: 'Product not found.' };
    const rel = getRelatedIn(ctx.catalogue, p);
    rel.forEach((r) => ctx.out.products.push(r));
    recordActivity(ctx, 'related');
    return { count: rel.length, products: rel.map(compactCard) };
  },

  getSameBrandProducts(args, ctx) {
    const p = ctx.bySku.get(Number(args.productId));
    if (!p) return { error: 'Product not found.' };
    const rel = getSameBrandIn(ctx.catalogue, p);
    rel.forEach((r) => ctx.out.products.push(r));
    recordActivity(ctx, 'brand');
    return { brand: p.brand || null, count: rel.length, products: rel.map(compactCard) };
  },

  compareProducts(args, ctx) {
    const ids = Array.isArray(args.productIds) ? args.productIds : [];
    const cmp = compareIn(ctx.catalogue, ids);
    cmp.forEach((c) => ctx.out.products.push(c));
    recordActivity(ctx, 'compare');
    return {
      products: cmp.map((c) => ({
        sku: c.sku,
        name: c.name,
        brand: c.brand,
        price: c.price,
        originalPrice: c.originalPrice,
        rating: c.rating,
        reviewCount: c.reviewCount,
        features: c.features,
      })),
    };
  },

  recommendProducts(args, ctx) {
    const recs = scoreRecommendations(ctx.catalogue, {
      cartLines: ctx.cartLines,
      budget: Number(args.budget) || ctx.session.budget || null,
      category: args.category ? String(args.category) : ctx.session.preferredCategory || null,
      limit: clampInt(args.limit, 4, 1, MAX_PRODUCTS_OUT),
    });
    recs.forEach((r) => {
      ctx.out.products.push(r);
      ctx.session.recommendedIds.add(Number(r.sku));
    });
    if (recs[0]) ctx.session.selectedId = Number(recs[0].sku); // best pick = current
    recordActivity(ctx, 'recommend');
    return {
      count: recs.length,
      products: recs.map((r) => ({ ...compactCard(r), reasons: r.reasons })),
    };
  },

  // ---- CART (stateless — validate + emit a cartAction; never mutate) ----
  getCart(_args, ctx) {
    recordActivity(ctx, 'cart');
    return {
      itemCount: ctx.cartPublic.reduce((s, l) => s + l.quantity, 0),
      total: ctx.cartTotal,
      items: ctx.cartPublic.map((l) => ({ sku: l.sku, name: l.name, quantity: l.quantity, price: l.price, lineTotal: l.lineTotal })),
    };
  },
  addToCart(args, ctx) {
    const id = Number(args.productId);
    let variant;
    // A colour/size passed on the add call is validated against the product's REAL
    // options (never fabricated); if the item needs a choice we ASK rather than guess.
    if (args.color !== undefined || args.size !== undefined) {
      const p = ctx.bySku.get(id);
      const r = resolveVariantSelection(p, { color: args.color, size: args.size });
      if (r.status === 'needs_selection') {
        recordActivity(ctx, 'variant');
        return { needsSelection: true, productId: r.productId, name: r.name, needs: r.needs, options: r.options };
      }
      if (r.status === 'ok' && (r.selection.color || r.selection.size)) variant = r.selection;
    } else if (ctx.session.selectedVariant && Number(ctx.session.selectedId) === id) {
      // Reuse a variant the customer already chose for THIS product this session.
      variant = ctx.session.selectedVariant;
    }
    return emitCartOp(ctx, 'add', args.productId, args.quantity, variant);
  },
  removeFromCart(args, ctx) {
    return emitCartOp(ctx, 'remove', args.productId);
  },
  updateCartQuantity(args, ctx) {
    return emitCartOp(ctx, 'update', args.productId, args.quantity);
  },
  clearCart(_args, ctx) {
    return emitCartOp(ctx, 'clear');
  },

  // ---- VARIANT SELECTION (PART 2 — real catalogue values only, never invents) ----
  selectProductVariant(args, ctx) {
    const id = Number(args.productId ?? ctx.session.selectedId);
    const p = ctx.bySku.get(id);
    if (!p) return { error: 'Which product? Search for or open a product first, then pick a variant.' };
    const r = resolveVariantSelection(p, { color: args.color, size: args.size });
    recordActivity(ctx, 'variant');
    ctx.session.selectedId = Number(p.sku);
    ctx.out.products.push(toPublic(p));
    if (r.status === 'error') return { error: r.error };
    if (r.status === 'needs_selection') {
      return {
        needsSelection: true,
        productId: r.productId,
        name: r.name,
        needs: r.needs,       // which of color/size still required
        invalid: r.invalid,   // any supplied value that wasn't a real option
        options: r.options,   // the REAL colour/size choices to offer
      };
    }
    // Clean, validated choice — remember it so a later "add it" uses this variant.
    ctx.session.selectedVariant = (r.selection.color || r.selection.size) ? r.selection : null;
    return { ok: true, productId: r.productId, name: r.name, selection: r.selection };
  },

  // ---- CART SUGGESTION (PART 13 — ask before changing, no mutation) ----
  proposeCartChange(args, ctx) {
    const op = String(args.op || 'add');
    if (!['add', 'remove', 'update', 'clear'].includes(op)) {
      return { error: `Unsupported operation: ${op}` };
    }
    let name = null;
    let price = null;
    let quantity;
    if (op !== 'clear') {
      const v = validateCartOp({
        products: ctx.catalogue,
        op,
        productId: args.productId,
        quantity: args.quantity ?? 1,
      });
      if (!v.valid) return { error: v.error };
      name = v.action.name;
      price = v.action.price ?? null;
      quantity = v.action.quantity;
    }
    ctx.out.pendingConfirmation = {
      op,
      productId: op === 'clear' ? null : Number(args.productId),
      name,
      price,
      quantity,
      reason: args.reason ? String(args.reason).slice(0, 200) : null,
    };
    recordActivity(ctx, 'propose');
    return { ok: true, awaitingConfirmation: true, op, product: name };
  },

  // ---- DEAL ----
  analyzeCartForBundle(_args, ctx) {
    recordActivity(ctx, 'bundle');
    return detectBundle(ctx.cartLines, { bundleDiscountEnabled: ctx.settings.bundleDiscountEnabled });
  },

  findBundleOpportunities(_args, ctx) {
    const opps = findBundleOpportunities(ctx.catalogue, ctx.cartLines, { limit: 4 });
    opps.forEach((o) => ctx.out.products.push(o));
    recordActivity(ctx, 'bundle');
    return { count: opps.length, products: opps.map((o) => ({ ...compactCard(o), reasons: o.reasons })) };
  },

  // ---- CART INTELLIGENCE (PART 5 — unified analysis over the REAL cart) ----
  analyzeCart(_args, ctx) {
    recordActivity(ctx, 'analyze');
    if (ctx.cartLines.length === 0) {
      return { empty: true, message: 'The cart is empty — add an item or two and I can analyze it.' };
    }
    // Enrich cart lines with catalogue category/subcategory (cartPublic omits them).
    const cartFull = ctx.cartLines.map((l) => {
      const full = ctx.bySku.get(Number(l.sku)) || {};
      return {
        sku: Number(l.sku),
        name: l.name || full.name,
        brand: l.brand || full.brand,
        category: l.category || full.category,
        subcategory: full.subcategory,
        quantity: l.quantity,
      };
    });
    const bundle = detectBundle(ctx.cartLines, { bundleDiscountEnabled: ctx.settings.bundleDiscountEnabled });
    const accessories = findAccessoriesFor(ctx.catalogue, cartFull, { limit: 4 });
    const complementary = findBundleOpportunities(ctx.catalogue, cartFull, { limit: 4 });
    // Surface suggested products for the UI (deduped against the accessories).
    const accSkus = new Set(accessories.map((a) => Number(a.sku)));
    accessories.forEach((a) => ctx.out.products.push(a));
    complementary.forEach((c) => { if (!accSkus.has(Number(c.sku))) ctx.out.products.push(c); });
    if (accessories.length) recordActivity(ctx, 'accessories');
    return {
      itemCount: bundle.totalUnits,
      distinctItems: bundle.distinctCount,
      categories: bundle.categories,
      isBundle: bundle.isBundle,
      dealEligible: bundle.dealEligible,
      missingAccessories: accessories.map((a) => compactCard(a)),
      complementary: complementary.map((c) => ({ ...compactCard(c), reasons: c.reasons })),
    };
  },

  checkNegotiationEligibility(_args, ctx) {
    if (ctx.cartLines.length === 0) {
      return { eligible: false, message: 'Your cart is empty — add items first.' };
    }
    const pc = buildPricingContext(ctx.cartLines, ctx.settings, ctx.cartTotal, {});
    recordActivity(ctx, 'eligibility');
    // NOTE: deliberately does NOT return the floor / minimum allowed price.
    return {
      eligible: pc.discountPossible,
      cartTotal: pc.cartTotal,
      maxDiscountPercent: pc.maxDiscountPercent,
      message: pc.discountPossible
        ? "A better price may be possible — I can negotiate on the merchant's behalf."
        : 'This cart is already at its best price.',
    };
  },

  startNegotiation(args, ctx) {
    return doStartNegotiation(ctx, args.offer);
  },

  getNegotiationState(_args, ctx) {
    recordActivity(ctx, 'cart');
    return ctx.session.lastNegotiation
      ? { ...ctx.session.lastNegotiation }
      : { none: true, message: 'No negotiation has happened yet this session.' };
  },

  acceptDeal(_args, ctx) {
    // Confirm + lock in the already-negotiated price. Server re-validates it
    // against the current cart; the AI never sets the final price (PART 9/13).
    return doAcceptDeal(ctx);
  },

  prepareCheckout(_args, ctx) {
    const s = doPrepareCheckout(ctx);
    // Compact result for the model — no costPrice, no internal fields.
    return {
      empty: s.empty,
      ready: s.ready,
      itemCount: s.itemCount,
      subtotal: s.subtotal,
      catalogueSavings: s.catalogueSavings,
      negotiatedSavings: s.negotiatedSavings,
      finalTotal: s.finalTotal,
      issues: s.issues,
    };
  },

  // ---- CHECKOUT HANDOFF (PART 9 — validate + navigate; NO order, NO payment) ----
  proceedToCheckout(_args, ctx) {
    const s = doPrepareCheckout(ctx); // server-authoritative totals (sets navigation)
    if (s.empty) return { empty: true, message: 'The cart is empty — add items before checking out.' };
    // Placing an order is authenticated-only; a guest is sent to checkout to log in.
    if (!ctx.userId) {
      ctx.out.navigation = { type: 'checkout', requiresAuth: true };
      return {
        authRequired: true,
        ready: false,
        itemCount: s.itemCount,
        finalTotal: s.finalTotal,
        message: 'Opening checkout — the customer needs to log in to place the order.',
      };
    }
    // Ready to hand off. This does NOT create an order and NEVER takes payment
    // (Razorpay handles payment separately, later).
    return {
      ok: true,
      ready: s.ready,
      itemCount: s.itemCount,
      subtotal: s.subtotal,
      catalogueSavings: s.catalogueSavings,
      negotiatedSavings: s.negotiatedSavings,
      finalTotal: s.finalTotal,
      issues: s.issues,
      navigation: 'checkout',
    };
  },

  // ---- PERSONALIZATION (PART 12–14 — authenticated, own data only) ----
  // Each requires an authenticated user (ctx.userId). Without it they return
  // { authRequired:true } so the agent asks the customer to log in — it never
  // fabricates history and never reads another user's data.
  getMyOrders(_args, ctx) {
    if (!ctx.userId || !ctx.userContext) return { authRequired: true, message: 'The customer must log in to view their orders.' };
    recordActivity(ctx, 'orders');
    ctx.out.navigation = { type: 'orders' }; // "show my orders" opens the orders view
    const orders = ctx.userContext.orders || [];
    return {
      count: orders.length,
      orders: orders.slice(0, 10).map((o) => ({
        id: o.id,
        date: o.createdAt,
        itemCount: o.itemCount,
        finalTotal: o.finalTotal,
        totalSavings: o.totalSavings,
        status: o.status,
        items: o.items.map((i) => ({ name: i.name, quantity: i.quantity })),
      })),
    };
  },

  async getOrderDetails(args, ctx) {
    if (!ctx.userId) return { authRequired: true, message: 'The customer must log in to view an order.' };
    recordActivity(ctx, 'orders');
    const id = String(args.orderId || '').trim();
    // Prefer the already-loaded, ownership-scoped orders.
    let order = (ctx.userContext?.orders || []).find((o) => o.id === id);
    // Fall back to a scoped DB read (still enforces ownership via userId).
    if (!order && /^[0-9a-fA-F]{24}$/.test(id)) {
      const doc = await Order.findOne({ _id: id, userId: ctx.userId });
      if (doc) order = doc.toSafeJSON();
    }
    // If no id was given, default to the most recent order.
    if (!order && !id) order = (ctx.userContext?.orders || [])[0];
    if (!order) return { error: 'No matching order found for your account.' };
    ctx.out.navigation = { type: 'order', param: order.id }; // open that order's detail view
    return {
      order: {
        id: order.id,
        date: order.createdAt,
        status: order.status,
        itemCount: order.itemCount,
        subtotal: order.subtotal,
        catalogueSavings: order.catalogueSavings,
        negotiatedDiscount: order.negotiatedDiscount,
        finalTotal: order.finalTotal,
        totalSavings: order.totalSavings,
        payment: order.payment,
        items: order.items.map((i) => ({ name: i.name, quantity: i.quantity, price: i.priceAtPurchase, lineTotal: i.lineTotal })),
      },
    };
  },

  getPersonalizedRecommendations(args, ctx) {
    if (!ctx.userId || !ctx.userContext) return { authRequired: true, message: 'The customer must log in for personalized recommendations.' };
    const history = ctx.userContext.history;
    // Affinity from BOTH the current cart and real past purchases; never invent.
    const seeds = [
      ...ctx.cartLines.map((l) => ({ sku: l.sku, brand: l.brand, category: l.category })),
      ...(ctx.userContext.purchasedSeeds || []),
    ];
    const recs = scoreRecommendations(ctx.catalogue, {
      cartLines: seeds, // already-owned/in-cart skus are excluded by the scorer
      budget: Number(args.budget) || ctx.session.budget || null,
      category: args.category ? String(args.category) : history.topCategories?.[0] || null,
      limit: clampInt(args.limit, 4, 1, MAX_PRODUCTS_OUT),
    });
    recs.forEach((r) => {
      ctx.out.products.push(r);
      ctx.session.recommendedIds.add(Number(r.sku));
    });
    recordActivity(ctx, history.hasHistory ? 'personalize' : 'recommend');
    return {
      count: recs.length,
      basis: history.hasHistory
        ? { source: 'history', orderCount: history.orderCount, preferredCategories: history.topCategories, recentItems: history.recentItems.slice(0, 3).map((i) => i.name) }
        : { source: 'cart', note: 'No purchase history yet — basing this on the current cart.' },
      products: recs.map((r) => ({ ...compactCard(r), reasons: r.reasons })),
    };
  },
};

/** Validate + emit a cart action (the ONLY way the agent changes a cart). */
function emitCartOp(ctx, op, productId, quantity, variant = null) {
  const v = validateCartOp({ products: ctx.catalogue, op, productId, quantity });
  if (!v.valid) return { error: v.error };
  // Attach a validated variant (real colour/size) so the client stores it on the line.
  if (variant && (variant.color || variant.size)) {
    v.action.variant = {
      ...(variant.color ? { color: variant.color } : {}),
      ...(variant.size ? { size: variant.size } : {}),
    };
  }
  ctx.out.cartActions.push(v.action);
  recordActivity(ctx, 'cartUpdate');
  if (op === 'clear') return { ok: true, cleared: true };
  return { ok: true, op, product: v.action.name, quantity: v.action.quantity ?? null, variant: v.action.variant || null };
}

function clampInt(v, def, min, max) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}

async function executeTool(name, args, ctx) {
  const fn = TOOLS[name];
  if (!fn) return { error: `Unknown tool: ${name}` };
  try {
    return await fn(args || {}, ctx);
  } catch (e) {
    console.warn(`[DealAI][agent] tool "${name}" failed:`, e.message);
    return { error: 'That tool could not complete.' };
  }
}

// ── Groq / OpenAI-compatible function-calling declarations ───────────────────
const OBJ = (properties, required = []) => ({ type: 'OBJECT', properties, required });
const TOOL_DECLARATIONS = [
  { name: 'searchProducts', description: 'Search the product catalogue by free text (name, brand, category, features). Understands budgets and Hinglish phrasing. Pass maxPrice (and/or minPrice) whenever the customer named a budget, e.g. "under 30000", "30000 ke andar", "gaming laptop under 60000".', parameters: OBJ({ query: { type: 'STRING', description: 'What the customer is looking for' }, maxPrice: { type: 'NUMBER', description: 'Upper price limit in ₹, if the customer gave one' }, minPrice: { type: 'NUMBER', description: 'Lower price limit in ₹, if the customer gave one' }, limit: { type: 'INTEGER' } }, ['query']) },
  { name: 'getProductDetails', description: 'Get full details for one product by its numeric id (sku): price, brand, features, description, stock.', parameters: OBJ({ productId: { type: 'INTEGER' } }, ['productId']) },
  { name: 'getProductReviews', description: 'Get a factual review summary (average, count, positive/negative themes) and a few sample reviews for one product.', parameters: OBJ({ productId: { type: 'INTEGER' } }, ['productId']) },
  { name: 'getRelatedProducts', description: 'Find products in the same category as the given product.', parameters: OBJ({ productId: { type: 'INTEGER' } }, ['productId']) },
  { name: 'getSameBrandProducts', description: 'Find other products from the same brand as the given product.', parameters: OBJ({ productId: { type: 'INTEGER' } }, ['productId']) },
  { name: 'compareProducts', description: 'Compare two or more products side by side by their numeric ids.', parameters: OBJ({ productIds: { type: 'ARRAY', items: { type: 'INTEGER' } } }, ['productIds']) },
  { name: 'recommendProducts', description: 'Rank the best products to recommend using multiple signals (rating, review volume, value, stock, and fit with the current cart). Optionally constrained by budget or category.', parameters: OBJ({ budget: { type: 'NUMBER' }, category: { type: 'STRING' }, limit: { type: 'INTEGER' } }) },
  { name: 'getCart', description: 'Read the customer\'s current cart: items, quantities, and total.', parameters: OBJ({}) },
  { name: 'addToCart', description: 'Add a product to the cart. ONLY call this when the customer has EXPLICITLY authorized adding THIS product (e.g. "add it", "yes add the socks", "isko cart mein daal do"). If the customer delegated the choice to you ("you decide", "best wala add karo", "surprise me"), do NOT add directly — use recommendProducts then proposeCartChange and wait for their confirmation. If the product has colour/size options, pass the chosen color/size (must be a REAL option) or call selectProductVariant first.', parameters: OBJ({ productId: { type: 'INTEGER' }, quantity: { type: 'INTEGER' }, color: { type: 'STRING', description: "Chosen colour — MUST be one of the product's real options" }, size: { type: 'STRING', description: "Chosen size — MUST be one of the product's real options" } }, ['productId']) },
  { name: 'selectProductVariant', description: "Choose (or check) a colour/size for a product using its REAL options only. Call this when a product has variants and the customer needs to pick one before adding, or names a colour/size. Returns needsSelection with the real options to offer when the choice is missing or invalid — never guess a variant.", parameters: OBJ({ productId: { type: 'INTEGER' }, color: { type: 'STRING' }, size: { type: 'STRING' } }) },
  { name: 'removeFromCart', description: 'Remove a product from the cart. ONLY call when the customer explicitly asked to remove it.', parameters: OBJ({ productId: { type: 'INTEGER' } }, ['productId']) },
  { name: 'updateCartQuantity', description: 'Set the quantity of a product already in the cart. ONLY call when the customer explicitly asked.', parameters: OBJ({ productId: { type: 'INTEGER' }, quantity: { type: 'INTEGER' } }, ['productId', 'quantity']) },
  { name: 'clearCart', description: 'Empty the entire cart. ONLY call when the customer explicitly asked to clear/empty it.', parameters: OBJ({}) },
  { name: 'proposeCartChange', description: 'Propose a cart change and ASK the customer to confirm it, WITHOUT applying it. Use this whenever you think a change is a good idea but the customer has not explicitly authorized it yet.', parameters: OBJ({ op: { type: 'STRING', description: 'add | remove | update | clear' }, productId: { type: 'INTEGER' }, quantity: { type: 'INTEGER' }, reason: { type: 'STRING' } }, ['op']) },
  { name: 'analyzeCartForBundle', description: 'Analyze whether the current cart forms a bundle and whether it may qualify for a better deal.', parameters: OBJ({}) },
  { name: 'findBundleOpportunities', description: 'Find complementary products (same brand / category) that pair well with the current cart to unlock a better bundle.', parameters: OBJ({}) },
  { name: 'analyzeCart', description: "Analyze the customer's ACTUAL cart and suggest what's useful: missing accessories that complete the items (e.g. a bag/mouse for a laptop, a case/earbuds for a phone), complementary same-brand/category products, and whether it forms a bundle deal. Use for 'analyze my cart', 'mere cart ko analyze karo', 'what should I add'. Suggestions are REAL in-stock products only — never forces a recommendation.", parameters: OBJ({}) },
  { name: 'checkNegotiationEligibility', description: 'Check whether the current cart is eligible for a better negotiated price.', parameters: OBJ({}) },
  { name: 'startNegotiation', description: "Negotiate the current cart on the merchant's behalf using the merchant's pricing engine. Pass the customer's target price as offer if they gave one; omit offer to ask for the best possible price.", parameters: OBJ({ offer: { type: 'NUMBER' } }) },
  { name: 'getNegotiationState', description: 'Return the most recent negotiation result from this session, if any.', parameters: OBJ({}) },
  { name: 'acceptDeal', description: "Confirm and lock in the price the customer already negotiated, after they EXPLICITLY accept it (e.g. 'accept the deal', 'deal accept karo', 'yes lock it in'). The server re-validates the deal against the current cart and applies it to the checkout total — you NEVER set the price yourself. This does NOT navigate to checkout and NEVER takes payment; the customer still says 'checkout karo' to proceed. If no deal was negotiated yet, it says so.", parameters: OBJ({}) },
  { name: 'prepareCheckout', description: 'Prepare a checkout summary for the current cart: itemised lines, subtotal, catalogue savings, any negotiated savings that still apply, final total, and any stock issues. Use when the customer wants to check out / review their order / is ready to buy. Does NOT take payment.', parameters: OBJ({}) },
  { name: 'proceedToCheckout', description: "Hand the customer off to the checkout page with a server-calculated total. Use for 'checkout karo', 'proceed to checkout', 'place my order'. Validates the cart and, if the customer is logged in, opens checkout; if not, opens checkout in login-required mode. This NEVER creates an order and NEVER takes payment — always confirm the customer wants to check out before calling it.", parameters: OBJ({}) },
  { name: 'getMyOrders', description: "Get the logged-in customer's own past orders (date, item count, total, savings, status). Use for 'my orders', 'what did I buy', 'order history'. Requires the customer to be logged in.", parameters: OBJ({}) },
  { name: 'getOrderDetails', description: "Get full details of ONE of the logged-in customer's own orders by its id (omit orderId for their most recent order). Requires login; only ever returns the customer's own order.", parameters: OBJ({ orderId: { type: 'STRING' } }) },
  { name: 'getPersonalizedRecommendations', description: "Recommend products personalized to the logged-in customer using their REAL order history (preferred categories/brands, recent purchases) plus the current cart. Requires login. If the customer has no history, it falls back to cart-based recommendations and says so — it NEVER invents past purchases.", parameters: OBJ({ budget: { type: 'NUMBER' }, category: { type: 'STRING' }, limit: { type: 'INTEGER' } }) },
];

const GROQ_TOOLS = TOOL_DECLARATIONS.map((t) => ({
  type: 'function',
  function: {
    name: t.name,
    description: t.description,
    parameters: {
      type: 'object',
      properties: Object.fromEntries(
        Object.entries(t.parameters.properties || {}).map(([k, v]) => [
          k,
          {
            type: (v.type || 'string').toLowerCase() === 'array' ? 'array' : (v.type || 'string').toLowerCase() === 'number' || (v.type || 'string').toLowerCase() === 'integer' ? 'number' : 'string',
            description: v.description || '',
            ...(v.items ? { items: { type: (v.items.type || 'string').toLowerCase() } } : {}),
          },
        ])
      ),
      required: t.parameters.required || [],
    },
  },
}));

const SYSTEM_PROMPT = `You are DealAI, a friendly, sharp AI shopping assistant embedded in an e-commerce store. You act on behalf of the MERCHANT while genuinely helping the customer shop and get a fair deal.

You have TOOLS. Decide which to call. NEVER invent products, prices, specifications, reviews, ratings, or stock — every such fact MUST come from a tool result or the provided catalogue. If information is not available, say so plainly.

GREETINGS & CASUAL CONVERSATION:
- When the user sends casual messages or greetings like "hello", "hi", "hey", "good morning", "good evening", "thanks", "thank you", "okay", or "ok", respond naturally, warmly, and in a Hinglish-aware tone like a friendly AI shopping assistant.
- Do NOT call any product, search, recommendation, cart, or negotiation tools for greetings or casual conversation.
- Example response for greetings like "hello" or "hi":
  "👋 Hello! Welcome to DealAI 😊
  Main aapka personal shopping assistant hoon. Product search, comparison, recommendations, cart updates aur best deal negotiation me help kar sakta hoon.
  Bataiye, aaj kya shopping karni hai?"
- For casual acknowledgements like "thanks", "thank you", or "okay", reply naturally and warmly without calling any tools.

How to work:
- Understand the request, then call the tools you need (you may call several in sequence) before answering.
- Prices and product ids ALWAYS come from tools/catalogue — never make up a price.
- To recommend, prefer recommendProducts (it weighs rating, review volume, value, stock and cart fit) and then EXPLAIN briefly why the top pick is a good choice.
- Reference products by name, and keep replies concise, warm and specific.
- Always show prices in Indian Rupees using the ₹ symbol (e.g. ₹2,500). Never use $ or any other currency.
- Customers often write in Hinglish (e.g. "Mujhe 30000 ke andar best phone chahiye", "isko cart mein daal do", "mere cart ko analyze karo", "quantity 2 kar do", "checkout karo"). Understand these naturally, extract the budget/product/quantity, and reply in the same warm tone (light Hinglish is fine).

CART PERMISSION RULES (important):
- Call addToCart / removeFromCart / updateCartQuantity / clearCart ONLY when the customer has clearly authorized THAT specific change — e.g. "add it", "yes", "remove the cap", "clear my cart".
- AUTONOMOUS PICKS: when the customer asks YOU to choose ("you decide and add the best for my cart", "pick the best one for me", "surprise me"), use recommendProducts to select the single best item, then call proposeCartChange with a short reason and ASK them to confirm. Do NOT call addToCart until they confirm (e.g. "yes, add it").
- If you believe a change is a good idea but the customer has NOT clearly authorized it, call proposeCartChange instead (it asks them to confirm) — never mutate the cart without authorization.
- VARIANTS: if a product has colour/size options and the customer hasn't picked one, call selectProductVariant (or ask) using ONLY the product's REAL options — never invent a colour/size. Pass the chosen color/size to addToCart. If the customer clearly named a valid option, you may select it directly.

CART ANALYSIS:
- For "analyze my cart", "mere cart ko analyze karo", or "what's useful to add", call analyzeCart. It inspects the ACTUAL cart and returns missing accessories (e.g. a bag/mouse for a laptop, a case/earbuds for a phone) and complementary REAL products. Suggest only what genuinely helps — do NOT force or pad recommendations.

NEGOTIATION & DEALS:
- BUNDLES: when the cart has items that logically pair (e.g. laptop + mouse/bag, phone + case/earbuds), call analyzeCartForBundle / findBundleOpportunities to surface the opportunity and, if useful, proposeCartChange to complete it.
- When the customer wants a better price / the best deal ("best deal lao", "deal lao"), call startNegotiation. It uses the merchant's own pricing engine and enforces the merchant's limits. Report ONLY what it returns.
- ACCEPTANCE: a negotiated price is a PROPOSAL. When the customer EXPLICITLY accepts it ("accept the deal", "deal accept karo", "lock it in"), call acceptDeal — the server re-validates the deal against the current cart and locks the amount in. NEVER apply a negotiated price silently; wait for their explicit acceptance. acceptDeal does not take payment and does not by itself open checkout.
- Describe negotiation truthfully as negotiating "on the merchant's behalf" / "using the merchant's pricing engine". NEVER claim an external company was contacted, and never quote a discount you made up — only report what the tools returned. You never set the final price yourself; the server does.
- FAILURE: if negotiation isn't available or the deal no longer fits the cart, do NOT break the flow — explain it and continue with the current server-verified cart price.

CHECKOUT:
- When the customer wants to review their order, call prepareCheckout and summarize the result (items, final total, any savings, and any stock issues).
- When the customer clearly wants to check out ("checkout karo", "proceed to checkout", "place my order"), call proceedToCheckout — it validates the cart and opens the checkout page with a SERVER-calculated total. It NEVER creates an order and NEVER takes payment (Razorpay handles payment separately, later), so never claim an order was placed or paid.

PERSONALIZATION (only when the customer is logged in — a "user" object will be present in the store context):
- Greet a returning, logged-in customer by name when it fits naturally.
- For "what did I order", "my orders", or order history, call getMyOrders; for one specific/most-recent order call getOrderDetails. These return ONLY this customer's own orders.
- For personalized suggestions, call getPersonalizedRecommendations — it uses the customer's REAL past purchases and cart. NEVER fabricate or assume past purchases. If they have no history, say so plainly ("You don't have enough purchase history yet, but based on your current cart…") and recommend from the cart.
- If the customer is NOT logged in and asks about their orders or wants personalization, briefly ask them to log in — do not guess.
- NEVER reveal or discuss account internals (email, password, tokens, ids) — you don't have them and must not ask for them.

Do not reveal internal steps, cost prices, margins, or price floors. Give the customer a helpful, natural answer.`;

function getAiModels() {
  const raw = readEnv('AI_MODELS');
  if (raw) {
    const list = raw.split(',').map((s) => s.trim()).filter(Boolean);
    if (list.length > 0) return list;
  }
  const single = readEnv('AI_MODEL');
  if (single) return [single];
  return ['gemini-3.5-flash', 'gemini-3.5-flash-lite'];
}

function isRetryable(status, errMessage = '') {
  if (typeof status === 'number') {
    if ([404, 429, 500, 502, 503, 504].includes(status)) return true;
  }
  const msg = String(errMessage).toLowerCase();
  return (
    msg.includes('429') ||
    msg.includes('resource_exhausted') ||
    msg.includes('quota') ||
    msg.includes('rate limit') ||
    msg.includes('temporarily unavailable') ||
    msg.includes('timeout') ||
    msg.includes('aborted') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('fetch failed') ||
    msg.includes('not_found') ||
    msg.includes('no longer available')
  );
}

const GEMINI_TOOLS = [
  {
    functionDeclarations: TOOL_DECLARATIONS.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    })),
  },
];

const TOOL_LABELS = {
  searchProducts: '🔎 Searched the catalogue',
  getProductDetails: '📋 Looked up product details',
  getProductReviews: '⭐ Analyzed customer reviews',
  getRelatedProducts: '🔗 Found related products',
  recommendProducts: '✨ Ranked the best options',
  addToCart: '🛒 Added item to cart',
  removeFromCart: '🛒 Removed item from cart',
  updateCartQuantity: '🛒 Updated cart quantity',
  clearCart: '🛒 Cleared cart',
  proposeCartChange: '💡 Prepared a suggestion',
  analyzeCart: '🧠 Analyzed your cart',
  analyzeCartForBundle: '💰 Analyzed bundle opportunities',
  findBundleOpportunities: '💰 Checked bundle opportunities',
  startNegotiation: "🤝 Negotiated on merchant's behalf",
  acceptDeal: '🤝 Deal validated & locked in',
  prepareCheckout: '🧾 Prepared checkout',
  proceedToCheckout: '🧾 Proceeded to checkout',
  selectProductVariant: '🎨 Checked variant options',
  getMyOrders: '📦 Looked up your orders',
  getOrderDetails: '📦 Looked up order details',
  getPersonalizedRecommendations: '🎯 Personalized recommendations',
};

// ── The real bounded multi-step Gemini tool loop with multi-model failover ───
async function runGeminiLoop({ message, ctx, onEvent }) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('AI API key not configured');

  const models = getAiModels();
  const baseUrl = getBaseUrl();

  // Compact, safe snapshot the model can use directly (saves tool round-trips).
  const catalogueBrief = ctx.catalogue.map((p) => ({
    sku: p.sku,
    name: p.name,
    brand: p.brand,
    category: p.category,
    price: p.price,
    rating: p.rating,
    reviewCount: p.reviewCount,
    inStock: Number(p.inventory) > 0,
  }));
  const contextBlock = {
    cart: ctx.cartPublic,
    cartTotal: ctx.cartTotal,
    budget: ctx.session.budget,
    catalogue: catalogueBrief,
  };
  if (ctx.userContext) {
    const h = ctx.userContext.history;
    contextBlock.user = {
      name: ctx.userContext.name,
      loggedIn: true,
      previousOrders: h.orderCount,
      recentPurchases: h.recentItems.slice(0, 5).map((i) => i.name),
      preferredCategories: h.topCategories,
    };
  } else {
    contextBlock.user = { loggedIn: false };
  }

  // Build Gemini contents array from session history
  const rawHistory = (ctx.session.history || []).filter((h) => h && h.text);
  while (rawHistory.length > 0 && (rawHistory[0].role === 'model' || rawHistory[0].role === 'assistant')) {
    rawHistory.shift();
  }

  const contents = [];
  for (const h of rawHistory) {
    const role = h.role === 'model' || h.role === 'assistant' ? 'model' : 'user';
    if (contents.length > 0 && contents[contents.length - 1].role === role) {
      contents[contents.length - 1].parts.push({ text: h.text });
    } else {
      contents.push({ role, parts: [{ text: h.text }] });
    }
  }

  const userTurnText = `${message}\n\n[Store context — use these ids/prices, do not invent]\n${JSON.stringify(contextBlock)}`;

  if (contents.length > 0 && contents[contents.length - 1].role === 'user') {
    contents[contents.length - 1].parts.push({ text: userTurnText });
  } else {
    contents.push({ role: 'user', parts: [{ text: userTurnText }] });
  }

  let currentModelIdx = 0;
  let finalText = '';

  // Emit a real "analyzing" signal the instant the loop starts, BEFORE the first
  // (blocking) model turn — so the HUD shows genuine progress immediately instead
  // of dead air while turn 1 waits on Gemini. This is tied to the actual loop
  // boundary, not a timer; it is cleared as soon as real tool events arrive.
  if (typeof onEvent === 'function') {
    onEvent({ type: 'tool_start', tool: 'analyze', label: TOOL_LABELS.analyze || '🧠 Analyzing your request' });
  }

  for (let turn = 0; turn < MAX_AGENT_TURNS; turn++) {
    let responseData = null;
    let turnSuccess = false;

    while (currentModelIdx < models.length && !turnSuccess) {
      const activeModel = models[currentModelIdx];
      console.log(`[DealAI][Gemini] model=${activeModel}`);
      console.log(`[DealAI][Gemini] request`);
      // Boundary trace: this is the ONLY blocking wait per agent turn — each
      // model turn is one non-streaming :generateContent call. The gap between
      // GEMINI_REQUEST_START and GEMINI_RESPONSE_RECEIVED is the real dead air
      // the user sees between visible SSE events (not a plumbing/flush issue).
      const gemT0 = Date.now();
      console.log(`[STREAM] GEMINI_REQUEST_START turn=${turn} model=${activeModel}`);

      const url = `${baseUrl}/models/${activeModel}:generateContent?key=${apiKey}`;
      const requestBody = {
        contents,
        tools: GEMINI_TOOLS,
        systemInstruction: {
          parts: [{ text: SYSTEM_PROMPT }],
        },
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 1024,
        },
      };

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), AGENT_TIMEOUT_MS);

      try {
        const res = await fetch(url, {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          const errMsg = errData.error?.message || `HTTP ${res.status}`;
          console.warn(`[DealAI][Gemini] failed status=${res.status}`);

          if (isRetryable(res.status, errMsg) && currentModelIdx + 1 < models.length) {
            currentModelIdx++;
            console.log(`[DealAI][Gemini] switching_to=${models[currentModelIdx]}`);
            await sleep(300);
            continue;
          } else {
            throw new Error(`Gemini API error: ${errMsg}`);
          }
        }

        responseData = await res.json();
        console.log(`[STREAM] GEMINI_RESPONSE_RECEIVED turn=${turn} +${Date.now() - gemT0}ms`);
        turnSuccess = true;
      } catch (err) {
        if (err.name === 'AbortError' || isRetryable(null, err.message)) {
          console.warn(`[DealAI][Gemini] failed status=${err.message}`);
          if (currentModelIdx + 1 < models.length) {
            currentModelIdx++;
            console.log(`[DealAI][Gemini] switching_to=${models[currentModelIdx]}`);
            await sleep(300);
            continue;
          }
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }
    }

    if (!turnSuccess || !responseData) {
      console.log(`[DealAI][Gemini] deterministic_fallback`);
      throw new Error('All configured Gemini models failed');
    }

    const candidate = responseData.candidates?.[0];
    const candidateContent = candidate?.content;
    const parts = candidateContent?.parts || [];

    const toolCallParts = parts.filter((p) => p.functionCall);
    const textPart = parts.find((p) => p.text);
    const text = textPart?.text ? textPart.text.trim() : '';

    if (toolCallParts.length === 0) {
      console.log(`[DealAI][Gemini] success`);
      finalText = text;
      if (text && typeof onEvent === 'function') {
        onEvent({ type: 'text_delta', text });
      }
      break;
    }

    console.log(`[DealAI][Gemini] tool_call`);
    console.log(`[DealAI][Gemini] success`);

    // Append model response with tool calls to contents
    contents.push(candidateContent || { role: 'model', parts });

    // Execute each tool and build functionResponse parts
    const responseParts = [];
    for (const callPart of toolCallParts) {
      const call = callPart.functionCall;
      const toolName = call.name;
      const defaultLabel = TOOL_LABELS[toolName] || '⚡ Executing action';

      if (typeof onEvent === 'function') {
        onEvent({ type: 'tool_start', tool: toolName, label: defaultLabel });
      }

      const result = await executeTool(toolName, call.args || {}, ctx);

      const latestLabel = ctx.out.activity[ctx.out.activity.length - 1] || defaultLabel;
      if (typeof onEvent === 'function') {
        onEvent({ type: 'tool_complete', tool: toolName, success: !result.error, label: latestLabel });
      }

      responseParts.push({
        functionResponse: {
          name: toolName,
          response: result,
        },
      });
    }

    // Append function response user message
    contents.push({
      role: 'user',
      parts: responseParts,
    });

    if (text && !finalText) {
      finalText = text;
      if (typeof onEvent === 'function') {
        onEvent({ type: 'text_delta', text });
      }
    }
  }

  return finalText || synthesizeMessage(ctx);
}

/** If the model produced no closing text, build a useful message from side effects. */
function synthesizeMessage(ctx) {
  if (ctx.out.negotiation) {
    const n = ctx.out.negotiation;
    return `I negotiated on the merchant's behalf: ${n.decision === 'ACCEPT' ? `accepted at ₹${n.finalPrice}` : n.decision === 'COUNTER_OFFER' ? `the merchant can offer ₹${n.finalPrice}` : `we couldn't reach that price`}.`;
  }
  if (ctx.out.pendingConfirmation) {
    const c = ctx.out.pendingConfirmation;
    return `Shall I ${c.op}${c.name ? ` ${c.name}` : ''}? Confirm and I'll update your cart.`;
  }
  if (ctx.out.checkout && !ctx.out.checkout.empty) {
    const c = ctx.out.checkout;
    return `Your order is ready: ${c.itemCount} item(s) for ₹${c.finalTotal}. Review it below and proceed when you're ready (payment is mocked for this demo).`;
  }
  if (ctx.out.cartActions.length) return 'Done — I updated your cart.';
  if (ctx.out.products.length) {
    const names = ctx.out.products.slice(0, 3).map((p) => p.name).join(', ');
    return `Here are some options: ${names}.`;
  }
  return 'How can I help you shop or find the best deal today?';
}

// ── Deterministic fallback agent (PART 18 — still uses the real tools) ────────
// Runs when Gemini is unavailable/at quota. Uses parseIntent + direct tool
// calls so every capability keeps working in a degraded-but-real way.
async function runAgentFallback({ message, ctx }) {
  const { intent, query, quantity } = parseIntent(message);
  const q = (query || '').trim();

  const firstMatch = (text) => {
    const [hit] = searchProductsIn(ctx.catalogue, text || message, { limit: 1 });
    return hit ? ctx.bySku.get(Number(hit.sku)) : null;
  };
  // Resolve which product a pronoun-y / empty command ("add it", "isko hatao")
  // refers to: an explicit name match wins, else the session's current selection.
  const PRONOUN = /^(it|this|that|one|ye|yeh|is|isko|ise|iski|usko|use|wo|woh|inko|inhe|inka)?$/i;
  const CONVERSATIONAL = new Set(['useful', 'lage', 'sahi', 'accha', 'achha', 'best', 'bhi', 'jo', 'wo', 'woh', 'wala', 'wali', 'wale', 'karo', 'daal', 'do', 'add', 'product', 'item']);
  const currentProduct = (text) => {
    const t = (text || '').trim();
    const meaningfulKws = extractKeywords(t).filter((w) => !CONVERSATIONAL.has(w.toLowerCase()));
    if (t && !PRONOUN.test(t) && meaningfulKws.length > 0) {
      const hit = firstMatch(meaningfulKws.join(' '));
      if (hit) return hit;
    }
    if (ctx.session.selectedId) {
      const sel = ctx.bySku.get(Number(ctx.session.selectedId));
      if (sel) return sel;
    }
    return null;
  };
  // The single cart item, when there is exactly one (handy for "hatao"/"qty 2").
  const soleCartProduct = () =>
    ctx.cartPublic.length === 1 ? ctx.bySku.get(Number(ctx.cartPublic[0].sku)) : null;

  switch (intent) {
    case 'view_cart': {
      recordActivity(ctx, 'cart');
      if (ctx.cartPublic.length === 0) {
        ctx.out.message = 'Your cart is empty right now. Tell me what you\'re after and I\'ll find something.';
      } else {
        const lines = ctx.cartPublic.map((l) => `• ${l.name} ×${l.quantity} — ₹${l.lineTotal}`).join('\n');
        ctx.out.message = `Your cart has ${ctx.cartPublic.length} item(s) worth ₹${ctx.cartTotal}:\n${lines}`;
      }
      return;
    }

    case 'reviews': {
      const p = firstMatch(q);
      if (!p) {
        ctx.out.message = `I couldn't find that product to check reviews. Which item did you mean?`;
        return;
      }
      const r = TOOLS.getProductReviews({ productId: p.sku }, ctx);
      ctx.out.message = r.summary?.available
        ? `${p.name} — ${r.summary.text} (${p.rating}★).`
        : `${p.name} doesn't have enough reviews yet to summarize.`;
      return;
    }

    case 'compare': {
      const matches = searchProductsIn(ctx.catalogue, q, { limit: 2 });
      if (matches.length < 2) {
        ctx.out.message = 'Tell me the two products you\'d like me to compare.';
        return;
      }
      const cmp = TOOLS.compareProducts({ productIds: matches.map((m) => m.sku) }, ctx).products;
      ctx.out.message = `Comparing:\n${cmp
        .map((c) => `• ${c.name} — ₹${c.price}, ${c.rating}★ (${c.reviewCount} reviews)`)
        .join('\n')}`;
      return;
    }

    case 'recommend': {
      // Personalize from real history when logged in (PART 13); else cart-based.
      const personalized = Boolean(ctx.userId && ctx.userContext);
      const recs = personalized
        ? TOOLS.getPersonalizedRecommendations({}, ctx).products
        : TOOLS.recommendProducts({}, ctx).products;
      if (recs.length === 0) {
        ctx.out.message = 'I need a bit more to go on — a category or budget would help.';
        return;
      }
      const top = recs[0];
      const why = (top.reasons || []).length ? ` — ${top.reasons.join(', ')}` : '';
      const hist = personalized ? ctx.userContext.history : null;
      const lead = hist && hist.hasHistory
        ? `Based on your past orders${hist.topCategories.length ? ` (you tend to buy ${hist.topCategories.join(', ')})` : ''} and your cart`
        : personalized
          ? `You don't have enough purchase history yet, but based on your current cart`
          : `Based on rating, reviews, value and fit with your cart`;
      ctx.out.message = `${lead}, I'd go with the ${top.name} (₹${top.price}, ${top.rating}★)${why}.`;
      return;
    }

    case 'bundle': {
      const b = TOOLS.analyzeCartForBundle({}, ctx);
      const opps = TOOLS.findBundleOpportunities({}, ctx).products;
      if (ctx.cartLines.length === 0) {
        ctx.out.message = 'Add an item or two and I\'ll find bundle opportunities that pair well and may unlock a better deal.';
        return;
      }
      if (opps.length) {
        ctx.out.message = `${b.dealEligible ? 'Your cart may qualify for a bundle deal. ' : ''}These pair well with your cart:\n${opps
          .map((o) => `• ${o.name} — ₹${o.price}${(o.reasons || []).length ? ` (${o.reasons.join(', ')})` : ''}`)
          .join('\n')}`;
      } else {
        ctx.out.message = 'I couldn\'t find a strong complementary product for your current cart right now.';
      }
      return;
    }

    case 'negotiate': {
      const r = await doStartNegotiation(ctx, captureOffer(message));
      if (r.error) {
        ctx.out.message = r.error;
        return;
      }
      ctx.out.message =
        r.decision === 'ACCEPT'
          ? `Done — negotiating on the merchant's behalf, your cart of ₹${r.originalPrice} is accepted at ₹${r.finalPrice} (${r.discountPercent}% off). ${r.reason}`
          : r.decision === 'COUNTER_OFFER'
            ? `I negotiated on the merchant's behalf: the best price the merchant can offer is ₹${r.finalPrice} (${r.discountPercent}% off ₹${r.originalPrice}). ${r.reason}`
            : `I negotiated on the merchant's behalf, but that price isn't workable. ${r.reason}`;
      // Nudge toward the explicit accept step (PART 9) when there's a real offer.
      if (r.decision === 'ACCEPT' || r.decision === 'COUNTER_OFFER') {
        ctx.out.message += ' Say "deal accept karo" to lock it in — nothing is charged yet.';
      }
      return;
    }

    case 'accept_deal': {
      // Explicit acceptance of the negotiated price (PART 9). Re-validated
      // server-side; the AI never sets the final price. Does NOT take payment.
      const r = doAcceptDeal(ctx);
      if (r.reason === 'no_deal') {
        ctx.out.message = 'I haven\'t negotiated a deal yet — say "best deal lao" and I\'ll get you the best price first.';
        return;
      }
      if (r.reason === 'empty_cart') {
        ctx.out.message = 'Your cart is empty, so there\'s no deal to apply. Add items and I\'ll negotiate again.';
        return;
      }
      ctx.out.message = r.accepted
        ? `Deal accepted ✓ Your negotiated total is ₹${r.finalTotal} for ${r.itemCount} item(s) — you save ₹${r.totalSavings} in all (₹${r.negotiatedSavings} from the deal). Say "checkout karo" when you're ready. Nothing is charged yet.`
        : `That deal no longer matches your current cart, so I've kept your verified price of ₹${r.finalTotal}. Say "best deal lao" to renegotiate for this cart. Nothing is charged yet.`;
      return;
    }

    case 'checkout': {
      // Checkout handoff (PART 9): server-authoritative total + navigate. NEVER
      // creates an order and NEVER takes payment (Razorpay is handled separately).
      const s = TOOLS.proceedToCheckout({}, ctx);
      if (s.empty) {
        ctx.out.message = 'Your cart is empty — add a few items and I\'ll take you to checkout.';
        return;
      }
      const savings = (s.catalogueSavings || 0) + (s.negotiatedSavings || 0);
      const parts = [`Your order total is ₹${s.finalTotal} for ${s.itemCount} item(s).`];
      if (savings > 0) parts.push(`You're saving ₹${savings}${s.negotiatedSavings > 0 ? ' (includes your negotiated deal)' : ''}.`);
      if (s.issues && s.issues.length) parts.push(`Heads up: ${s.issues.join(' ')}`);
      if (s.authRequired) parts.push('Opening checkout — please log in there to place the order. (Payment is handled separately — nothing is charged now.)');
      else parts.push('Opening checkout — review and place your order there. (Payment is handled separately — nothing is charged now.)');
      ctx.out.message = parts.join(' ');
      return;
    }

    case 'autopick': {
      // Autonomous selection (PART 5): pick the single best product for this
      // cart, then PROPOSE it and wait for confirmation — never silently add
      // (PART 10). The client shows a Confirm button on pendingConfirmation.
      let top;
      if (ctx.session.discussedIds && ctx.session.discussedIds.size > 0) {
        const pool = [...ctx.session.discussedIds].map((id) => ctx.bySku.get(Number(id))).filter(Boolean);
        const recs = scoreRecommendations(pool, { budget: ctx.session.budget, limit: 1 });
        if (recs[0]) top = recs[0];
      }
      if (!top) {
        let category = ctx.session.preferredCategory || null;
        if (!category && ctx.session.selectedId) {
          const sel = ctx.bySku.get(Number(ctx.session.selectedId));
          if (sel?.category) category = sel.category;
        }
        const picks = TOOLS.recommendProducts({ limit: 1, category }, ctx).products;
        top = picks[0];
      }
      if (!top) {
        ctx.out.message = 'Tell me a category or budget (or add an item) and I\'ll pick the best match for you.';
        return;
      }
      const why = (top.reasons || []).length
        ? top.reasons.join(', ')
        : 'best overall on rating, reviews and value';
      const res = TOOLS.proposeCartChange(
        { op: 'add', productId: top.sku, quantity: 1, reason: why },
        ctx
      );
      if (res.error) {
        ctx.out.message = `I'd pick the ${top.name} (₹${top.price}), but I couldn't queue it: ${res.error}`;
        return;
      }
      ctx.out.message = `I'd go with the ${top.name} — ₹${top.price}, ${top.rating}★ (${why}). Want me to add it? Confirm below and I'll update your cart.`;
      return;
    }

    case 'add': {
      // Pronoun / empty add ("isko daal do", "add it") falls back to the product
      // the customer is currently looking at (session.selectedId) instead of
      // guessing a random top match.
      const p = currentProduct(q);
      if (!p) {
        ctx.out.message = `I couldn't tell which product to add. Try a name like "headphones", or search first and say "add it".`;
        return;
      }
      // Remember the target so addToCart can reuse any variant chosen for it.
      ctx.session.selectedId = Number(p.sku);
      // Explicit "add ..." = authorization (PART 10).
      const res = TOOLS.addToCart({ productId: p.sku, quantity: 1 }, ctx);
      if (res.error) { ctx.out.message = res.error; return; }
      if (res.needsSelection) {
        const opts = [...(res.options?.colors || []), ...(res.options?.sizes || [])];
        ctx.out.message = `The ${res.name} needs a ${res.needs.join(' & ')} first${opts.length ? ` — options: ${opts.join(', ')}` : ''}. Which one would you like?`;
        return;
      }
      const vtxt = res.variant ? ` (${[res.variant.color, res.variant.size].filter(Boolean).join(', ')})` : '';
      ctx.out.message = `Added ${p.name}${vtxt} (₹${p.price}) to your cart.`;
      return;
    }

    case 'update_qty': {
      // Explicit numeric quantity ("quantity 2 kar do", "make it 3").
      const inCart = q ? ctx.cartPublic.find((l) => matchName(l.name, q)) : null;
      const p = inCart
        ? ctx.bySku.get(Number(inCart.sku))
        : (currentProduct(q) || soleCartProduct());
      if (!p) {
        ctx.out.message = `Which item's quantity should I change? Tell me the product name.`;
        return;
      }
      if (!Number.isFinite(quantity)) {
        ctx.out.message = `What quantity would you like for ${p.name}?`;
        return;
      }
      ctx.session.selectedId = Number(p.sku);
      if (quantity <= 0) {
        const res = TOOLS.removeFromCart({ productId: p.sku }, ctx);
        ctx.out.message = res.error ? res.error : `Removed ${p.name} from your cart.`;
        return;
      }
      const res = TOOLS.updateCartQuantity({ productId: p.sku, quantity }, ctx);
      ctx.out.message = res.error ? res.error : `Updated ${p.name} to quantity ${quantity}.`;
      return;
    }

    case 'remove': {
      // Prefer an item actually in the cart; then the current selection; then the
      // sole cart item (so "isko hatao" / "remove it" works with one item).
      const inCart = q ? ctx.cartPublic.find((l) => matchName(l.name, q)) : null;
      const p = inCart
        ? ctx.bySku.get(Number(inCart.sku))
        : (currentProduct(q) || soleCartProduct());
      if (!p) {
        ctx.out.message = `I couldn't tell which item to remove. What would you like to take out?`;
        return;
      }
      const res = TOOLS.removeFromCart({ productId: p.sku }, ctx);
      ctx.out.message = res.error ? res.error : `Removed ${p.name} from your cart.`;
      return;
    }

    case 'clear_cart': {
      TOOLS.clearCart({}, ctx);
      ctx.out.message = 'Cleared your cart.';
      return;
    }

    case 'analyze_cart': {
      // Cart intelligence (PART 5): inspect the REAL cart, surface genuinely
      // useful add-ons — never force recommendations.
      const a = TOOLS.analyzeCart({}, ctx);
      if (a.empty) { ctx.out.message = a.message; return; }
      const priced = (x) => `${x.name} (₹${x.price})`;
      const parts = [`Your cart has ${a.distinctItems} item(s)${a.isBundle ? ' — that\'s a bundle' : ''}.`];
      if (a.missingAccessories.length) {
        parts.push(`Useful add-ons: ${a.missingAccessories.map(priced).join(', ')}.`);
      } else if (a.complementary.length) {
        parts.push(`Pairs well with: ${a.complementary.map(priced).join(', ')}.`);
      }
      if (a.dealEligible) parts.push('It may also qualify for a bundle deal — want me to negotiate?');
      if (!a.missingAccessories.length && !a.complementary.length) {
        parts.push('I don\'t see an obvious add-on right now — your cart looks complete.');
      }
      // Make the top suggestion the "current" product so a natural follow-up
      // ("ye bhi add karo" / "add it too") adds THAT real product (PART 12 flow)
      // rather than re-adding whatever was last selected.
      const topSuggestion = a.missingAccessories[0] || a.complementary[0] || null;
      if (topSuggestion) ctx.session.selectedId = Number(topSuggestion.sku);
      ctx.out.message = parts.join(' ');
      return;
    }

    case 'my_orders': {
      if (!ctx.userId || !ctx.userContext) {
        ctx.out.message = 'Log in and I can pull up your past orders and tailor recommendations to what you buy.';
        return;
      }
      const r = TOOLS.getMyOrders({}, ctx);
      if (!r.orders || r.orders.length === 0) {
        ctx.out.message = "You don't have any orders yet. Once you place one, I'll show your history here and personalize your recommendations.";
        return;
      }
      const lines = r.orders
        .slice(0, 5)
        .map((o) => {
          const when = o.date ? new Date(o.date).toLocaleDateString('en-IN') : '';
          const names = o.items.map((i) => `${i.name}${i.quantity > 1 ? ` ×${i.quantity}` : ''}`).join(', ');
          return `• ${when} — ₹${o.finalTotal} (${o.status}): ${names}`;
        })
        .join('\n');
      ctx.out.message = `You have ${r.count} order${r.count === 1 ? '' : 's'}:\n${lines}`;
      return;
    }

    case 'order_details': {
      if (!ctx.userId) {
        ctx.out.message = 'Log in and I can pull up that order for you.';
        return;
      }
      const r = await TOOLS.getOrderDetails({ orderId: '' }, ctx); // most recent by default
      if (r.authRequired) {
        ctx.out.message = 'Log in and I can pull up that order for you.';
        return;
      }
      if (r.error || !r.order) {
        ctx.out.message = "I couldn't find that order on your account.";
        return;
      }
      const o = r.order;
      const when = o.date ? new Date(o.date).toLocaleDateString('en-IN') : '';
      const items = o.items.map((i) => `• ${i.name} ×${i.quantity} — ₹${i.lineTotal}`).join('\n');
      const savings = o.totalSavings > 0 ? ` You saved ₹${o.totalSavings}.` : '';
      ctx.out.message = `Your ${when} order (${o.status}) — ₹${o.finalTotal}:\n${items}${savings}`;
      return;
    }

    case 'search':
    default: {
      const results = TOOLS.searchProducts({ query: q || message }, ctx).products;
      if (results.length === 0) {
        ctx.out.message = `I couldn't find anything matching "${q || message}". Try a category like "electronics", "footwear" or "accessories".`;
        return;
      }
      const top = results[0];
      ctx.out.message = `I found ${results.length} option(s). The ${top.name} (₹${top.price}, ${top.rating}★) looks like a strong pick — want details, reviews, or should I add it?`;
    }
  }
}

const matchName = (name, q) => {
  const a = String(name || '').toLowerCase();
  const b = String(q || '').toLowerCase().trim();
  return b.length > 1 && (a.includes(b) || b.includes(a));
};

/** Pull an explicit numeric offer out of a negotiate message ("I'll pay 2500"). */
function captureOffer(message) {
  const hit = /(?:pay|offer|give you|for|at)\s*[₹]?\s*(?:rs\.?|inr)?\s*([0-9][0-9,]{2,})/i.exec(String(message || ''));
  if (!hit) return null;
  const n = Number(hit[1].replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ── Public entry point ────────────────────────────────────────────────────
/**
 * Run the agent for one user message.
 * @param {object} p
 * @param {string} p.message
 * @param {Array}  [p.cart]       client cart [{productId|id, quantity}]
 * @param {string} [p.sessionId]
 * @param {Array}  [p.history]    optional [{role, text}] to seed a fresh session
 * @param {string|null} [p.userId]  the AUTHENTICATED user id (from the verified
 *                                   token in the controller) — NEVER from the body
 * @returns {Promise<object>} { message, actions, products, cartActions, pendingConfirmation, cartUpdated, negotiation, checkout, navigation, usedFallback, sessionId }
 */
export async function runAgent({ message, cart = [], sessionId, history = [], userId = null }) {
  const session = getSession(sessionId);

  // Seed a fresh (or evicted) session from client-supplied history.
  if (session.history.length === 0 && Array.isArray(history)) {
    for (const h of history.slice(-MAX_HISTORY)) {
      if (h && (h.role === 'user' || h.role === 'model')) pushHistory(session, h.role, h.text);
    }
  }

  // Remember budget/category signals across the session (PART 16).
  const budget = captureBudget(message);
  if (budget) session.budget = budget;

  // DB is required to resolve the catalogue/cart safely.
  if (!isDbConnected()) {
    return {
      message: "I can't reach the product catalogue right now. Please try again in a moment.",
      actions: [],
      products: [],
      cartActions: [],
      pendingConfirmation: null,
      cartUpdated: false,
      negotiation: null,
      usedFallback: true,
      sessionId: session.id,
    };
  }

  const [catalogue, settings, resolved] = await Promise.all([
    loadCatalogue(),
    loadSettings(),
    resolveLines(cart),
  ]);
  // Load a SAFE personalization context for a logged-in customer (best-effort:
  // a failure here must never break the chat — the agent just runs anonymously).
  let userContext = null;
  if (userId) {
    try {
      userContext = await loadUserContext(userId);
    } catch (e) {
      console.warn('[DealAI][agent] user context load failed:', e.message);
      userContext = null;
    }
  }
  const cartLines = resolved.lines; // costPrice-bearing — SERVER ONLY, never returned
  const bySku = new Map(catalogue.map((p) => [Number(p.sku), p]));
  const cartPublic = cartLines.map((l) => ({
    sku: l.sku,
    name: l.name,
    brand: l.brand,
    price: l.price,
    quantity: l.quantity,
    lineTotal: l.price * l.quantity,
  }));
  const cartTotal = cartPublic.reduce((s, l) => s + l.lineTotal, 0);

  const out = {
    message: '',
    activity: [],
    products: [],
    cartActions: [],
    pendingConfirmation: null,
    negotiation: null,
    checkout: null,
    navigation: null,
  };
  const ctx = { catalogue, bySku, cartLines, cartPublic, cartTotal, settings, session, userId: userId || null, userContext, out };

  let usedFallback = false;
  try {
    if (!isAgentAiConfigured()) throw new Error('no-key');
    out.message = await runGeminiLoop({ message, ctx });
  } catch (err) {
    console.warn('[DealAI][agent] AI loop failed → deterministic fallback:', err.message);
    usedFallback = true;
    // Discard any partial side effects so the fallback produces a clean result.
    out.activity = [];
    out.products = [];
    out.cartActions = [];
    out.pendingConfirmation = null;
    out.negotiation = null;
    out.checkout = null;
    out.navigation = null;
    try {
      await runAgentFallback({ message, ctx });
    } catch (fe) {
      console.warn('[DealAI][agent] fallback failed:', fe.message);
      out.message = 'Sorry — I had trouble with that. Could you rephrase?';
    }
  }

  const products = dedupeBySku(out.products).slice(0, MAX_PRODUCTS_OUT);
  for (const p of products) session.discussedIds.add(Number(p.sku));

  // Persist the exchange to session memory.
  pushHistory(session, 'user', message);
  pushHistory(session, 'model', out.message);
  session.updatedAt = Date.now();

  return {
    message: out.message || 'How can I help you shop today?',
    actions: out.activity,
    products,
    cartActions: out.cartActions,
    pendingConfirmation: out.pendingConfirmation,
    cartUpdated: out.cartActions.length > 0,
    negotiation: out.negotiation,
    checkout: out.checkout,
    navigation: out.navigation,
    usedFallback,
    sessionId: session.id,
  };
}

/**
 * Stream real-time agent execution events (SSE) for one user message.
 */
export async function runAgentStream({ message, cart = [], sessionId, history = [], userId = null, onEvent }) {
  const emit = (event) => {
    if (typeof onEvent === 'function') {
      try {
        onEvent(event);
      } catch {
        // client closed connection
      }
    }
  };

  emit({ type: 'start' });

  const session = getSession(sessionId);

  if (session.history.length === 0 && Array.isArray(history)) {
    for (const h of history.slice(-MAX_HISTORY)) {
      if (h && (h.role === 'user' || h.role === 'model')) pushHistory(session, h.role, h.text);
    }
  }

  const budget = captureBudget(message);
  if (budget) session.budget = budget;

  if (!isDbConnected()) {
    const err = "I can't reach the product catalogue right now. Please try again in a moment.";
    emit({ type: 'text_delta', text: err });
    emit({
      type: 'complete',
      message: err,
      actions: [],
      products: [],
      cartActions: [],
      pendingConfirmation: null,
      cartUpdated: false,
      negotiation: null,
      usedFallback: true,
      sessionId: session.id,
    });
    return;
  }

  const [catalogue, settings, resolved] = await Promise.all([
    loadCatalogue(),
    loadSettings(),
    resolveLines(cart),
  ]);

  let userContext = null;
  if (userId) {
    try {
      userContext = await loadUserContext(userId);
    } catch {
      userContext = null;
    }
  }

  const cartLines = resolved.lines;
  const bySku = new Map(catalogue.map((p) => [Number(p.sku), p]));
  const cartPublic = cartLines.map((l) => ({
    sku: l.sku,
    name: l.name,
    brand: l.brand,
    price: l.price,
    quantity: l.quantity,
    lineTotal: l.price * l.quantity,
  }));
  const cartTotal = cartPublic.reduce((s, l) => s + l.lineTotal, 0);

  const out = {
    message: '',
    activity: [],
    products: [],
    cartActions: [],
    pendingConfirmation: null,
    negotiation: null,
    checkout: null,
    navigation: null,
  };
  const ctx = { catalogue, bySku, cartLines, cartPublic, cartTotal, settings, session, userId: userId || null, userContext, out };

  let usedFallback = false;
  try {
    if (!isAgentAiConfigured()) throw new Error('no-key');
    out.message = await runGeminiLoop({ message, ctx, onEvent: emit });
  } catch (err) {
    console.warn('[DealAI][agent] Stream AI loop failed → fallback:', err.message);
    usedFallback = true;
    out.activity = [];
    out.products = [];
    out.cartActions = [];
    out.pendingConfirmation = null;
    out.negotiation = null;
    out.checkout = null;
    out.navigation = null;
    try {
      await runAgentFallback({ message, ctx });
      if (out.activity.length) {
        for (const act of out.activity) {
          emit({ type: 'tool_complete', tool: 'fallback', success: true, label: act });
        }
      }
    } catch (fe) {
      console.warn('[DealAI][agent] Stream fallback failed:', fe.message);
      out.message = 'Sorry — I had trouble with that. Could you rephrase?';
    }
  }

  const products = dedupeBySku(out.products).slice(0, MAX_PRODUCTS_OUT);
  for (const p of products) session.discussedIds.add(Number(p.sku));

  const finalMsg = out.message || 'How can I help you shop today?';

  pushHistory(session, 'user', message);
  pushHistory(session, 'model', finalMsg);
  session.updatedAt = Date.now();

  emit({
    type: 'complete',
    message: finalMsg,
    actions: out.activity,
    products,
    cartActions: out.cartActions,
    pendingConfirmation: out.pendingConfirmation,
    cartUpdated: out.cartActions.length > 0,
    negotiation: out.negotiation,
    checkout: out.checkout,
    navigation: out.navigation,
    usedFallback,
    sessionId: session.id,
  });
}

import Product from '../models/Product.js';
import { isDbConnected } from '../config/db.js';
import { summarizeReviews } from '../services/agentTools.js';
import { buildSearchSpec, rankProductsForSpec, scoreProductForSpec } from '../utils/searchQuery.js';

// ─────────────────────────────────────────────────────────────────────────
// productController.js — customer-facing product reads (never exposes costPrice).
//
// Product ids are the stable numeric `sku` used by the frontend; a 24-hex Mongo
// _id is also accepted. Unknown ids return a friendly 404 (never a crash), and
// missing optional fields are simply omitted so the UI can show
// "Information not available" gracefully.
// ─────────────────────────────────────────────────────────────────────────

const SAFE_PROJECTION = { costPrice: 0, __v: 0 };

function dbGuard(res) {
  if (!isDbConnected()) {
    res.status(503).json({ success: false, error: 'Product database is not connected. Please try again shortly.' });
    return false;
  }
  return true;
}

/** Resolve one product by numeric sku or 24-hex Mongo _id. */
async function findByIdParam(idParam) {
  const asNumber = Number(idParam);
  if (Number.isFinite(asNumber)) {
    const bySku = await Product.findOne({ sku: asNumber });
    if (bySku) return bySku;
  }
  if (typeof idParam === 'string' && /^[0-9a-fA-F]{24}$/.test(idParam)) {
    return Product.findById(idParam);
  }
  return null;
}

// GET /api/products — full catalogue (safe projection).
export async function listProducts(_req, res) {
  if (!dbGuard(res)) return;
  try {
    const products = await Product.find({}, SAFE_PROJECTION).sort({ sku: 1 });
    return res.json({ success: true, products: products.map((p) => p.toSafeJSON()) });
  } catch (err) {
    console.error('[DealAI] Failed to list products:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to load products.' });
  }
}

// GET /api/products/search — filtered + paginated product search.
// Query params: q, category, subcategory, brand, minPrice, maxPrice, rating, discount, sort, page, limit, inStock
//
// Free-text `q` is parsed by the SHARED searchQuery brain (server/utils/searchQuery.js)
// — the SAME parser the AI agent uses — so the website and the agent always agree on
// the same real MongoDB data. It understands budgets (English + Hinglish) and synonyms.
// When there is a text query we fetch the structurally-filtered candidates and rank
// them in-memory with that brain (the catalogue is small), which gives word-boundary
// precision (so "phone" never matches "headphones") and never returns an empty page
// for a budget query. Explicit sidebar Min/Max stay a HARD filter; a budget parsed
// from the sentence is SOFT (within-budget items first, over-budget still shown last).
export async function searchProducts(req, res) {
  if (!dbGuard(res)) return;
  try {
    const {
      q = '',
      category,
      subcategory,
      brand,
      minPrice,
      maxPrice,
      rating,
      discount,
      sort = 'relevance',
      page = 1,
      limit = 24,
      inStock,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(48, Math.max(1, parseInt(limit, 10) || 24));
    const skip = (pageNum - 1) * limitNum;

    // Structured (hard) filters — applied by Mongo regardless of text query.
    const filter = {};
    if (category) filter.category = { $regex: new RegExp(`^${escapeRegExp(category)}$`, 'i') };
    if (subcategory) filter.subcategory = { $regex: new RegExp(`^${escapeRegExp(subcategory)}$`, 'i') };
    if (brand) {
      const brands = brand.split(',').map((b) => b.trim()).filter(Boolean);
      filter.brand = { $in: brands.map((b) => new RegExp(`^${escapeRegExp(b)}$`, 'i')) };
    }
    // Explicit numeric price bounds from the sidebar are a HARD filter.
    const explicitMin = numOrNull(minPrice);
    const explicitMax = numOrNull(maxPrice);
    if (explicitMin != null) filter.price = { ...filter.price, $gte: explicitMin };
    if (explicitMax != null) filter.price = { ...filter.price, $lte: explicitMax };
    if (rating !== undefined && !isNaN(Number(rating))) filter.rating = { $gte: Number(rating) };
    if (discount !== undefined && !isNaN(Number(discount))) {
      const discountFraction = Number(discount) / 100;
      filter.$expr = {
        $gte: [
          { $divide: [{ $subtract: ['$originalPrice', '$price'] }, '$originalPrice'] },
          discountFraction,
        ],
      };
    }
    if (inStock === 'true') filter.inventory = { $gt: 0 };

    const projection = { ...SAFE_PROJECTION, reviews: 0 };
    const trimmedQ = String(q || '').trim();

    // ── No text query → classic Mongo browse (featured/rating/price sort + paginate).
    if (!trimmedQ) {
      const sortObj = mongoSort(sort);
      const [products, total] = await Promise.all([
        Product.find(filter, projection).sort(sortObj).skip(skip).limit(limitNum),
        Product.countDocuments(filter),
      ]);
      return res.json({
        success: true,
        products: products.map((p) => p.toCardJSON()),
        pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
      });
    }

    // ── Text query → rank in-memory with the shared brain (parity with the AI agent).
    // Parsed budget stays SOFT (ranking only); explicit bounds already hard-filtered above.
    const parsedSpec = buildSearchSpec(trimmedQ); // keywords + budget parsed from the sentence
    const rankSpec = {
      keywords: parsedSpec.keywords,
      minPrice: explicitMin ?? parsedSpec.minPrice,
      maxPrice: explicitMax ?? parsedSpec.maxPrice,
    };
    // Candidate set = everything passing the structured filters (small catalogue).
    const candidates = await Product.find(filter, projection).limit(1000);

    let ranked;
    if (sort === 'relevance') {
      // Full shared ranking: keyword relevance + within-budget-first, never empty for a budget.
      ranked = rankProductsForSpec(candidates, rankSpec, { limit: candidates.length });
    } else {
      // Explicit sort requested: keep only genuine keyword matches, then order by that field.
      const matched = rankSpec.keywords.length
        ? candidates.filter((p) => scoreProductForSpec(p, rankSpec.keywords) > 0)
        : candidates.slice();
      matched.sort(jsSort(sort));
      ranked = matched;
    }

    const total = ranked.length;
    const pageItems = ranked.slice(skip, skip + limitNum);
    return res.json({
      success: true,
      products: pageItems.map((p) => p.toCardJSON()),
      pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.max(1, Math.ceil(total / limitNum)) },
    });
  } catch (err) {
    console.error('[DealAI] Search products error:', err.message);
    return res.status(500).json({ success: false, error: 'Search failed. Please try again.' });
  }
}

// Sort helpers ---------------------------------------------------------------
const numOrNull = (v) => (v !== undefined && v !== null && v !== '' && !isNaN(Number(v)) ? Number(v) : null);
const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Mongo sort object for the no-text-query browse path. */
function mongoSort(sort) {
  switch (sort) {
    case 'price_asc': return { price: 1 };
    case 'price_desc': return { price: -1 };
    case 'rating': return { rating: -1, reviewCount: -1 };
    case 'newest': return { createdAt: -1 };
    case 'discount': return { sku: 1 };
    default: return { isFeatured: -1, rating: -1 };
  }
}

/** In-memory comparator matching mongoSort, for the ranked text-query path. */
function jsSort(sort) {
  const disc = (p) => (p.originalPrice > 0 ? (p.originalPrice - p.price) / p.originalPrice : 0);
  switch (sort) {
    case 'price_asc': return (a, b) => (a.price || 0) - (b.price || 0);
    case 'price_desc': return (a, b) => (b.price || 0) - (a.price || 0);
    case 'rating': return (a, b) => (b.rating || 0) - (a.rating || 0) || (b.reviewCount || 0) - (a.reviewCount || 0);
    case 'newest': return (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    case 'discount': return (a, b) => disc(b) - disc(a);
    default: return (a, b) => (b.rating || 0) - (a.rating || 0);
  }
}

// GET /api/products/categories — list of unique categories with counts
export async function getCategories(_req, res) {
  if (!dbGuard(res)) return;
  try {
    const agg = await Product.aggregate([
      { $group: { _id: '$category', count: { $sum: 1 }, subcategories: { $addToSet: '$subcategory' } } },
      { $sort: { count: -1 } },
    ]);
    const categories = agg.map((a) => ({
      name: a._id,
      count: a.count,
      subcategories: (a.subcategories || []).filter(Boolean).sort(),
    }));
    return res.json({ success: true, categories });
  } catch (err) {
    console.error('[DealAI] Get categories error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to load categories.' });
  }
}

// GET /api/products/:id — one product's detail (safe projection, graceful 404).
export async function getProduct(req, res) {
  if (!dbGuard(res)) return;
  try {
    const product = await findByIdParam(req.params.id);
    if (!product) {
      return res.status(404).json({ success: false, error: 'Product not found.' });
    }
    return res.json({ success: true, product: product.toSafeJSON() });
  } catch (err) {
    console.error('[DealAI] Failed to load product:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to load product.' });
  }
}

// GET /api/products/:id/reviews — reviews + deterministic factual summary.
export async function getProductReviews(req, res) {
  if (!dbGuard(res)) return;
  try {
    const product = await findByIdParam(req.params.id);
    if (!product) {
      return res.status(404).json({ success: false, error: 'Product not found.' });
    }
    const reviews = Array.isArray(product.reviews) ? product.reviews : [];
    return res.json({
      success: true,
      productId: product.sku,
      name: product.name,
      rating: product.rating ?? null,
      reviewCount: product.reviewCount ?? reviews.length,
      summary: summarizeReviews(reviews, product.reviewCount),
      reviews: reviews.map((r) => ({
        user: r.user,
        rating: r.rating,
        title: r.title,
        comment: r.comment,
        verified: Boolean(r.verified),
        date: r.date || null,
      })),
    });
  } catch (err) {
    console.error('[DealAI] Failed to load reviews:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to load reviews.' });
  }
}

// GET /api/products/:id/related — products in same category (excluding self)
export async function getRelatedProducts(req, res) {
  if (!dbGuard(res)) return;
  try {
    const product = await findByIdParam(req.params.id);
    if (!product) {
      return res.status(404).json({ success: false, error: 'Product not found.' });
    }
    const related = await Product.find(
      { category: product.category, sku: { $ne: product.sku } },
      { costPrice: 0, __v: 0, reviews: 0, specifications: 0 }
    )
      .sort({ rating: -1 })
      .limit(8);
    return res.json({ success: true, products: related.map((p) => p.toCardJSON()) });
  } catch (err) {
    console.error('[DealAI] Failed to load related products:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to load related products.' });
  }
}

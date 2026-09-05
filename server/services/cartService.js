import Product from '../models/Product.js';

// ─────────────────────────────────────────────────────────────────────────
// cartService.js — resolve client cart line items → trusted Product documents.
//
// Shared by the negotiation controller and the agent so both compute cart
// totals from the REAL catalogue (never trusting client-supplied prices).
// `costPrice` is included on each line for server-side margin math ONLY and
// must never be returned to the client.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Resolve [{productId|id, quantity}] against MongoDB.
 * The frontend references products by their stable numeric id (stored as `sku`);
 * a genuine 24-hex Mongo _id is also accepted (e.g. for curl testing).
 *
 * @returns {Promise<{lines: Array, missing: Array}>}
 */
export async function resolveLines(items) {
  const cleaned = (Array.isArray(items) ? items : []).map((it) => ({
    productId: it.productId ?? it.id,
    quantity: Math.max(1, Math.floor(Number(it.quantity) || 1)),
  }));

  const skus = cleaned
    .map((c) => Number(c.productId))
    .filter((n) => Number.isFinite(n));
  // Only treat a value as a Mongo _id if it's a genuine 24-hex string. (Note:
  // mongoose.isValidObjectId() loosely returns true for plain numbers like the
  // frontend's numeric ids, which must go to the sku lookup instead.)
  const objectIds = cleaned
    .map((c) => c.productId)
    .filter((id) => typeof id === 'string' && /^[0-9a-fA-F]{24}$/.test(id));

  const or = [];
  if (skus.length) or.push({ sku: { $in: skus } });
  if (objectIds.length) or.push({ _id: { $in: objectIds } });

  const products = or.length ? await Product.find({ $or: or }) : [];
  const bySku = new Map(products.map((p) => [String(p.sku), p]));
  const byMongoId = new Map(products.map((p) => [String(p._id), p]));

  const lines = [];
  const missing = [];
  for (const c of cleaned) {
    const p =
      bySku.get(String(Number(c.productId))) || byMongoId.get(String(c.productId));
    if (!p) {
      missing.push(c.productId);
      continue;
    }
    lines.push({
      sku: p.sku,
      name: p.name,
      brand: p.brand,
      category: p.category,
      price: p.price,
      originalPrice: p.originalPrice ?? p.price, // for catalogue-savings / order snapshot
      image: p.image, // for order snapshot (customer-safe)
      costPrice: p.costPrice, // internal — used for margin math only, never returned
      inventory: p.inventory,
      quantity: c.quantity,
    });
  }
  return { lines, missing };
}

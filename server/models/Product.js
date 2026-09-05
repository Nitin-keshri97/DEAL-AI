import mongoose from 'mongoose';

// Product catalogue. `sku` is a stable numeric id that mirrors the id used by
// the existing frontend (src/data/products.js) so the cart can reference
// products without knowing MongoDB ObjectIds.
//
// SECURITY: `costPrice` is internal merchant data and must NEVER be sent to the
// customer frontend. Use Product.toSafeJSON() / .toCardJSON() / the controller's
// safe mappers.

// A single customer review. Stored inline on the product (no separate _id).
const reviewSchema = new mongoose.Schema(
  {
    user: { type: String, trim: true },
    rating: { type: Number, min: 0, max: 5 },
    title: { type: String, trim: true },
    comment: { type: String, trim: true },
    verified: { type: Boolean, default: false },
    date: { type: String },
  },
  { _id: false }
);

const productSchema = new mongoose.Schema(
  {
    sku: { type: Number, index: true },
    name: { type: String, required: true, trim: true },
    brand: { type: String, trim: true },
    category: { type: String, trim: true },
    subcategory: { type: String, trim: true },           // e.g. "Running Shoes" inside "Footwear"
    price: { type: Number, required: true, min: 0 },
    originalPrice: { type: Number, min: 0 },
    costPrice: { type: Number, required: true, min: 0 }, // internal — never exposed
    inventory: { type: Number, default: 0, min: 0 },
    rating: { type: Number, default: 0 },
    reviewCount: { type: Number, default: 0 },
    features: { type: [String], default: [] },
    tags: { type: [String], default: [] },
    reviews: { type: [reviewSchema], default: [] },
    image: { type: String },
    images: { type: [String], default: [] },             // gallery images array
    description: { type: String },
    // Specifications: key-value pairs e.g. { "RAM": "16GB", "Storage": "512GB" }
    specifications: { type: Map, of: String, default: () => new Map() },
    // Variants
    colors: { type: [String], default: [] },
    sizes: { type: [String], default: [] },
    // Logistics
    delivery: { type: String },                          // e.g. "Free delivery in 3-5 days"
    warranty: { type: String },                          // e.g. "1 year manufacturer warranty"
    returnPolicy: { type: String },                      // e.g. "7 days easy return"
    highlights: { type: [String], default: [] },         // short marketing bullets
    isNew: { type: Boolean, default: false },
    isFeatured: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Text index for full-text search across key fields
productSchema.index({
  name: 'text',
  brand: 'text',
  category: 'text',
  subcategory: 'text',
  description: 'text',
  tags: 'text',
});

// Safe projection for anything customer-facing — strips costPrice + internals.
// Includes the full detail (features, reviews) for the product-detail view.
productSchema.methods.toSafeJSON = function toSafeJSON() {
  const obj = this.toObject({ virtuals: true });
  delete obj.costPrice;
  delete obj.__v;
  // Convert specifications Map to plain object for JSON serialisation
  if (obj.specifications instanceof Map) {
    obj.specifications = Object.fromEntries(obj.specifications);
  } else if (obj.specifications && typeof obj.specifications === 'object') {
    obj.specifications = Object.fromEntries(Object.entries(obj.specifications));
  }
  return obj;
};

// Compact projection for grids / in-chat cards / search results.
productSchema.methods.toCardJSON = function toCardJSON() {
  const obj = this.toObject({ virtuals: true });
  delete obj.costPrice;
  delete obj.__v;
  delete obj.reviews;
  delete obj.specifications;
  if (obj.specifications instanceof Map) {
    delete obj.specifications;
  }
  return obj;
};

const Product = mongoose.model('Product', productSchema);
export default Product;

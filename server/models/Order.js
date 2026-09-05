import mongoose from 'mongoose';

// ─────────────────────────────────────────────────────────────────────────
// Order.js — a placed order (Day 5).
//
// An order is an immutable SNAPSHOT: each line copies the product's name, image
// and the price AT PURCHASE TIME so later catalogue/price changes never rewrite
// history. All money fields are computed SERVER-SIDE (orderController) from
// trusted DB prices via the tested buildCheckoutSummary — the client's totals,
// prices, discounts and userId are never trusted (spec PARTs 8/10/19).
//
// SECURITY: costPrice / margin never appear here. `userId` ties the order to its
// owner; the controller enforces that a user can only read their OWN orders.
// Payment is a MOCK — status stays 'mock_pending'; nothing here claims a real
// charge occurred.
// ─────────────────────────────────────────────────────────────────────────

const ORDER_STATUSES = ['Placed', 'Confirmed', 'Processing', 'Shipped', 'Delivered', 'Cancelled'];
export { ORDER_STATUSES };

// One purchased line — a point-in-time snapshot, not a live reference.
const orderItemSchema = new mongoose.Schema(
  {
    productId: { type: Number, required: true }, // === Product.sku
    name: { type: String, required: true },
    brand: { type: String }, // snapshot — powers order-history personalization
    category: { type: String }, // snapshot — powers order-history personalization
    image: { type: String },
    priceAtPurchase: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1 },
    lineTotal: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    items: { type: [orderItemSchema], required: true },

    // Server-computed money (all whole rupees). finalTotal is authoritative.
    subtotal: { type: Number, required: true, min: 0 }, // Σ priceAtPurchase·qty
    originalTotal: { type: Number, required: true, min: 0 }, // Σ originalPrice·qty
    catalogueSavings: { type: Number, default: 0, min: 0 }, // originalTotal − subtotal
    negotiatedDiscount: { type: Number, default: 0, min: 0 }, // subtotal − finalTotal (if a deal applied)
    finalTotal: { type: Number, required: true, min: 0 }, // what the customer "pays"
    totalSavings: { type: Number, default: 0, min: 0 }, // catalogueSavings + negotiatedDiscount

    status: { type: String, enum: ORDER_STATUSES, default: 'Placed' },

    // Payment (Day 8: real Razorpay Test-Mode). `status` is a plain String — not
    // an enum — so legacy demo orders keep working; known values:
    //   'mock_pending' (legacy demo) | 'created' (Razorpay order made, unpaid)
    //   | 'paid' (signature VERIFIED server-side) | 'cancelled' | 'failed'.
    // An order is PAID only after razorpayService.verifyPaymentSignature passes.
    // The signature is stored for audit; it is NOT a secret (it cannot reveal the
    // Key Secret) but it is withheld from toSafeJSON as the client has no use for it.
    payment: {
      method: { type: String, default: 'demo' },
      provider: { type: String, default: 'demo' }, // 'demo' | 'razorpay'
      status: { type: String, default: 'mock_pending' },
      razorpayOrderId: { type: String, index: true, sparse: true },
      razorpayPaymentId: { type: String },
      razorpaySignature: { type: String },
      paidAt: { type: Date },
    },
  },
  { timestamps: true }
);

orderSchema.index({ userId: 1, createdAt: -1 }); // fast "my orders, newest first"

// Customer-safe projection. `userId` is returned as a plain string (its owner
// already knows it); no internal Mongoose types leak.
orderSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: String(this._id),
    userId: String(this.userId),
    items: (this.items || []).map((i) => ({
      productId: i.productId,
      name: i.name,
      brand: i.brand || null,
      category: i.category || null,
      image: i.image || null,
      priceAtPurchase: i.priceAtPurchase,
      quantity: i.quantity,
      lineTotal: i.lineTotal,
    })),
    subtotal: this.subtotal,
    originalTotal: this.originalTotal,
    catalogueSavings: this.catalogueSavings,
    negotiatedDiscount: this.negotiatedDiscount,
    finalTotal: this.finalTotal,
    totalSavings: this.totalSavings,
    status: this.status,
    payment: {
      method: this.payment?.method || 'demo',
      provider: this.payment?.provider || 'demo',
      status: this.payment?.status || 'mock_pending',
      // Useful Razorpay references (safe to show the owner); the signature is
      // deliberately omitted — the client never needs it.
      razorpayOrderId: this.payment?.razorpayOrderId || null,
      razorpayPaymentId: this.payment?.razorpayPaymentId || null,
      paidAt: this.payment?.paidAt || null,
    },
    itemCount: (this.items || []).reduce((s, i) => s + (Number(i.quantity) || 0), 0),
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

const Order = mongoose.model('Order', orderSchema);
export default Order;

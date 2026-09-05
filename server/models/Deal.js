import mongoose from 'mongoose';

// Explicit sub-schemas avoid Mongoose's inline-definition pitfalls (notably the
// reserved `type` key — a field literally named "type" must be declared as
// { type: { type: String } } or Mongoose treats the whole object as a String).

const cartItemSchema = new mongoose.Schema(
  {
    sku: Number,
    name: String,
    price: Number,
    quantity: Number,
    category: String,
  },
  { _id: false }
);

const customerContextSchema = new mongoose.Schema(
  {
    type: { type: String }, // disambiguated — this is a field named "type"
    previousOrders: Number,
  },
  { _id: false }
);

// A persisted record of every negotiation outcome. Stores only safe line data
// (no costPrice). Useful for the Day-5 analytics dashboard.
const dealSchema = new mongoose.Schema(
  {
    cartItems: [cartItemSchema],
    cartTotal: Number,
    customerOffer: Number,
    negotiationRound: Number,

    decision: {
      type: String,
      enum: ['ACCEPT', 'COUNTER_OFFER', 'REJECT'],
      required: true,
    },

    discountPercent: Number,
    discountAmount: Number,
    finalPrice: Number,

    reason: [String],
    aiConfidence: Number,

    // Non-sensitive metadata for future analytics.
    engine: { type: String, enum: ['ai', 'fallback'], default: 'ai' },
    intent: String,
    bundle: Boolean,
    customerContext: customerContextSchema,
  },
  { timestamps: true }
);

const Deal = mongoose.model('Deal', dealSchema);
export default Deal;

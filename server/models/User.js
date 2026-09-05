import mongoose from 'mongoose';

// ─────────────────────────────────────────────────────────────────────────
// User.js — a registered DealAI shopper (Day 5).
//
// SECURITY:
//   • `passwordHash` holds a scrypt hash (see server/utils/auth.js) — the plain
//     password is NEVER stored. `passwordHash` must NEVER be sent to the client
//     or into the AI context: always project through toSafeJSON().
//   • `email` is stored lowercased + unique so duplicate signups are rejected
//     at the database level as well as in the controller.
//
// The per-user `cart` is a BEST-EFFORT server mirror of the client-authoritative
// cart (localStorage remains the source of truth). It lets a logged-in shopper
// pick up their cart on another device; it never overrides the client blindly.
// ─────────────────────────────────────────────────────────────────────────

// Mirror of a client cart line — references a product by its stable numeric sku.
const cartLineSchema = new mongoose.Schema(
  {
    productId: { type: Number, required: true }, // === Product.sku / frontend id
    quantity: { type: Number, required: true, min: 1 },
  },
  { _id: false }
);

// Avatar background colours (design-system friendly). Chosen at signup so the
// profile/nav avatar is stable and needs no image upload.
export const AVATAR_COLORS = ['#4f46e5', '#0ea5e9', '#059669', '#d97706', '#db2777', '#7c3aed', '#dc2626', '#0d9488'];

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    passwordHash: { type: String, required: true }, // scrypt$salt$hash — never exposed
    avatarColor: { type: String, default: '#4f46e5' },
    cart: { type: [cartLineSchema], default: [] },   // best-effort mirror
    wishlist: { type: [Number], default: [] },       // array of product skus
  },
  { timestamps: true }
);

// Customer-safe projection. NEVER includes passwordHash / __v / the raw cart.
// `id` is the string form of _id so the frontend never sees a Mongo ObjectId type.
userSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: String(this._id),
    name: this.name,
    email: this.email,
    avatarColor: this.avatarColor,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

const User = mongoose.model('User', userSchema);
export default User;

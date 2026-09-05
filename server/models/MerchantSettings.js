import mongoose from 'mongoose';

// Merchant-defined guardrails for the negotiation engine. These are the hard
// business constraints the AI is never allowed to cross. Stored as a single
// document; the controller falls back to DEFAULT_SETTINGS if none exists yet.
const merchantSettingsSchema = new mongoose.Schema(
  {
    maxDiscountPercent: { type: Number, default: 10, min: 0, max: 100 },
    minimumMarginPercent: { type: Number, default: 15, min: 0, max: 100 },
    bundleDiscountEnabled: { type: Boolean, default: true },
    aiNegotiationEnabled: { type: Boolean, default: true },
    maxNegotiationRounds: { type: Number, default: 3, min: 1 },
  },
  { timestamps: true }
);

// Central default — used both for seeding and as an in-memory fallback so the
// negotiation engine keeps working even before settings are seeded.
export const DEFAULT_SETTINGS = {
  maxDiscountPercent: 10,
  minimumMarginPercent: 15,
  bundleDiscountEnabled: true,
  aiNegotiationEnabled: true,
  maxNegotiationRounds: 3,
};

const MerchantSettings = mongoose.model('MerchantSettings', merchantSettingsSchema);
export default MerchantSettings;

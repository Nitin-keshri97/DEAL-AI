# DealAI

> AI-powered bargaining for modern commerce.

**Tagline:** "Let AI negotiate. You protect the margin."

Built for the **Razorpay AI Buildathon** · AI Growth & Agentic Commerce Track.

---

## Current Status

### ✅ Day 1 — Customer Frontend Foundation

- [x] Product browsing with category filters
- [x] Shopping cart with quantity controls
- [x] Cart persistence via localStorage
- [x] Cart drawer with item management
- [x] Bargain / Deal modal UI
- [x] Offer validation and error handling
- [x] AI placeholder state ("Coming Soon")
- [x] Fully responsive — Mobile, Tablet, Desktop
- [x] How It Works section
- [x] Feature / Trust section
- [x] Professional footer with buildathon attribution

### ✅ Day 2 — Backend + AI Negotiation Engine

- [x] Node.js + Express API
- [x] MongoDB Atlas via Mongoose
- [x] Product model (with internal `costPrice`, never exposed)
- [x] Merchant rules model (max discount, min margin, bundle, rounds)
- [x] Deal model (persisted negotiation history)
- [x] `POST /api/deals/negotiate` — real negotiation endpoint
- [x] AI negotiation engine with a **provider-agnostic abstraction**
- [x] **Server-side pricing validation** — the AI can never breach merchant rules
- [x] **Deterministic fallback** engine when the AI is unavailable / invalid
- [x] Real cart total computed server-side (client totals are never trusted)
- [x] `Ask DealAI` button wired to the backend with loading / error / result states
- [x] Accept / Counter-offer / Reject result UI

---

## Architecture

```
Customer
   ↓
React (DealModal → src/lib/api.js)
   ↓  POST /api/deals/negotiate
Express API
   ↓
MongoDB (products, merchant settings)
   ↓
Business Rules  (utils/calculations.js — pricing floors)
   ↓
AI Deal Agent   (services/aiDealService.js — provider abstraction)
   ↓
Validation Layer (services/dealValidationService.js — clamps/rejects unsafe AI output)
   ↓            ↘ (on AI failure) services/fallbackService.js
Deal Response (safe fields only — no costPrice / margin / floors)
   ↓
React result UI (Accept / Counter / Reject)
```

**Pricing safety** — the final price must satisfy **both** merchant rules, using the stricter (higher) floor:
1. **Max-discount floor:** `cartTotal × (1 − maxDiscountPercent/100)`
2. **Min-margin floor:** `totalCost ÷ (1 − minimumMarginPercent/100)`

The AI is given structured business context but its output is **never trusted** — every decision is clamped to these floors on the server (or replaced by the deterministic fallback).

---

## Coming Next

| Day | Focus |
|-----|-------|
| **Day 3** | Merchant Rules Dashboard (configure rules live) |
| **Day 4** | Razorpay Payment Integration |
| **Day 5** | Analytics, edge cases, final polish |

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Framework | React 19 + Vite 8 |
| Styling | Tailwind CSS v4 |
| Icons | Lucide React |
| State | React Context + useReducer |
| Backend | Node.js + Express |
| Database | MongoDB Atlas + Mongoose |
| AI | Provider-agnostic (OpenAI-compatible Chat Completions) via env vars |

---

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure the backend

```bash
# Copy the template and fill in your values
cp server/.env.example server/.env
```

Set in `server/.env`:

| Variable | Required | Notes |
|----------|----------|-------|
| `PORT` | no | Defaults to `5000` |
| `MONGODB_URI` | **yes** | MongoDB Atlas connection string |
| `CLIENT_ORIGIN` | no | Allowed frontend origin(s); defaults to the Vite dev server |
| `AI_API_KEY` | no | Leave blank to run purely on the deterministic rules engine |
| `AI_MODEL` | no | e.g. `gpt-4o-mini` |
| `AI_BASE_URL` | no | API root, e.g. `https://api.openai.com/v1` |

> 🔒 `AI_API_KEY`, `MONGODB_URI` and product `costPrice` are **never** exposed to the frontend. `.env` files are git-ignored.

### 3. Seed the database

```bash
npm run seed
```

Seeds 8 products (matching the frontend catalogue) + default merchant settings
(max discount 10%, min margin 15%, bundles on, AI on, 3 rounds).

### 4. Run

```bash
npm run dev        # frontend (Vite)  → http://localhost:5173
npm run server     # backend (Express) → http://localhost:5000
npm run dev:all    # both together (uses concurrently)
```

### Useful commands

```bash
npm run build        # production frontend build
npm run test:server  # run the negotiation-engine safety tests (no DB required)
npm run lint         # oxlint
```

---

## API

**`GET /api/health`** → `{ "status": "ok", "service": "DealAI API", "db": "connected" }`

**`POST /api/deals/negotiate`**

```jsonc
// request
{
  "items": [{ "productId": 1, "quantity": 1 }, { "productId": 2, "quantity": 1 }],
  "customerOffer": 2500,
  "customerContext": { "type": "returning", "previousOrders": 4 }
}

// response (safe fields only)
{
  "success": true,
  "deal": {
    "decision": "COUNTER_OFFER",
    "originalPrice": 2800,
    "customerOffer": 2500,
    "finalPrice": 2520,
    "discountAmount": 280,
    "discountPercent": 10,
    "savings": 280,
    "reason": ["Your offer exceeds the permitted discount boundary", "..."],
    "confidence": 74,
    "bundle": true,
    "usedFallback": false
  }
}
```

**`GET /api/products`** → safe product catalogue (no `costPrice`).

---

## Project Structure

```
src/                          — Frontend (React, unchanged from Day 1)
├── components/DealModal.jsx  — now calls the backend + renders real decisions
├── lib/api.js                — backend client (VITE_API_URL configurable)
└── ...

server/                       — Backend (Day 2)
├── config/db.js              — Mongoose connection (fails gracefully)
├── models/                   — Product, MerchantSettings, Deal
├── routes/dealRoutes.js      — POST /api/deals/negotiate
├── controllers/dealController.js
├── services/
│   ├── aiDealService.js          — AI provider abstraction (swap here)
│   ├── dealValidationService.js  — server-side guardrail enforcement
│   └── fallbackService.js        — deterministic negotiator
├── utils/calculations.js     — pricing math + floors
├── seed/seedProducts.js      — seed products + merchant settings
├── test/negotiation.test.js  — engine safety tests
├── server.js                 — Express entry point
└── .env.example
```

---

## Future Vision

DealAI enables customers to negotiate personalized bundle prices through an autonomous AI
agent. The AI will analyze:

- Customer cart composition and total value
- Product margins and inventory levels
- Merchant-defined pricing rules and minimum margins
- Customer purchase history and intent signals
- Bundle synergy discounts

The merchant always maintains full control through a rule-based guardrail system. The AI
only negotiates within the boundaries the merchant defines.

---

## Business Model Insight

Traditional e-commerce uses fixed prices, leaving money on the table in both directions:
customers who would pay more, and customers lost because the price is slightly too high.

DealAI's AI negotiation creates a **price discovery layer** that maximizes conversion while
protecting merchant margins — a win on both sides.

---

*Built with ❤️ for the Razorpay AI Buildathon 2024*

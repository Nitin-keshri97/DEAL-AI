# 🤖 DealAI

### Your Autonomous AI Shopping Agent

> **DealAI doesn't just recommend products — it searches, compares, decides, acts, negotiates, and takes you to checkout.**

Built for the **Razorpay AI Buildathon** · AI Growth & Agentic Commerce Track.

DealAI is an autonomous AI shopping agent you can talk to in natural **Hindi / Hinglish** (voice or text). It understands a shopping request, runs the real workflow through a set of controlled server-side tools — search, inspect, compare, decide, add to cart, negotiate, check out — and completes a **Razorpay Test Mode** payment. The backend stays authoritative for identity, product data, pricing, and payment verification; the AI only ever acts within those guardrails.

---

## ✨ Features

| | Feature | Status |
|---|---------|--------|
| 🧠 | **AI Shopping Agent** — Gemini-powered agent that plans and executes multi-step shopping workflows via controlled tools | ✅ |
| 🎙️ | **Voice Shopping** — speak naturally in Hindi/Hinglish; the agent hears, acts, and speaks back a concise reply | ✅ |
| 🔎 | **Intelligent Product Search** — free-text search over real MongoDB products, budget- and Hinglish-aware | ✅ |
| ⚖️ | **Product Comparison** — side-by-side compare, review analysis, and autonomous "best pick" selection | ✅ |
| 🛒 | **Autonomous Cart Actions** — add, remove, and update quantities, driven by validated server actions | ✅ |
| 🧩 | **Cart Intelligence** — analyzes the current cart and recommends genuinely complementary products | ✅ |
| 🤝 | **AI Negotiation** — bounded negotiation on the merchant's behalf, clamped to merchant pricing rules | ✅ |
| 💳 | **Razorpay Test Checkout** — cart → checkout → Razorpay Test Mode → server-verified payment → order | ✅ |
| 📦 | **Order Management** — view your orders and full order details | ✅ |
| ⚡ | **Agent Streaming** — real-time SSE stream of the agent's live tool activity as it works | ✅ |
| 🔐 | **Server-Side Guardrails** — pricing, negotiation limits, and payment verification enforced on the server | ✅ |

---

## 🗣️ Voice Agent

DealAI ships with a hands-free voice agent (bottom-center of the shopping screen). Speak naturally in Hindi/Hinglish and it executes the resulting shopping workflow — it does not just chat.

> **You:** *"Mere liye 2000 ke andar best shoes dhundo, reviews compare karo, best wala cart me add karo."*
>
> **DealAI:** searches within budget → analyzes reviews → picks the best option → adds it to your cart → and confirms out loud.

How it works:

- **Speech recognition** — the browser Web Speech API captures your voice (tuned for `en-IN` / Hinglish).
- **Agent processing** — the transcript is sent to the Gemini agent, which decides which tools to run.
- **Real-time streaming activity** — the UI shows the agent's *actual* tool steps as they happen ("Searching products…", "Comparing products…", "Adding to cart…") over a live SSE stream — not a scripted checklist.
- **Concise voice response** — DealAI speaks back a short, sanitized confirmation (Markdown/emoji stripped, ₹ read as "Rupees"), never a wall of text.
- **Action-taking** — when the agent decides to add to cart or proceed to checkout, the frontend executes that server-authorized action immediately.

If streaming is unavailable, the agent transparently falls back to the standard request/response endpoint — no faked progress.

---

## 🧰 Agent Tools

The agent can only affect the system through a fixed set of server-side tools. Every tool runs against real MongoDB data and returns validated results; the AI never mutates state directly.

| Tool | What it does |
|------|--------------|
| `searchProducts` | Free-text catalogue search (name, brand, category, features); understands budgets and Hinglish phrasing |
| `getProductDetails` | Full details for one product: price, brand, features, description, stock |
| `getProductReviews` | Factual review summary (average, count, themes) plus sample reviews |
| `compareProducts` | Side-by-side comparison of two or more products |
| `getRelatedProducts` | Products in the same category |
| `getSameBrandProducts` | Other products from the same brand |
| `recommendProducts` | Ranks the best options using rating, review volume, value, stock, and cart fit; can be budget/category constrained |
| `analyzeCart` | Analyzes the actual cart and suggests real, in-stock complementary products |
| `findBundleOpportunities` | Finds complementary items that could unlock a better bundle |
| `getCart` | Reads the current cart: items, quantities, total |
| `addToCart` | Adds a product to the cart (server-validated) |
| `removeFromCart` | Removes a product from the cart |
| `updateCartQuantity` | Sets the quantity of a cart item |
| `clearCart` | Empties the cart (only on explicit request) |
| `selectProductVariant` | Validates a colour/size choice against the product's real options |
| `proposeCartChange` | Proposes a change and asks for confirmation *without* applying it |
| `startNegotiation` | Negotiates the current cart on the merchant's behalf, within pricing rules |
| `getNegotiationState` | Returns the most recent negotiation result for the session |
| `acceptDeal` | Locks in an already-negotiated price after the customer explicitly accepts |
| `prepareCheckout` | Builds a checkout summary (lines, subtotal, savings, final total) — no payment |
| `proceedToCheckout` | Hands off to the checkout page with a server-calculated total (login-aware) |
| `getMyOrders` | The logged-in customer's own past orders |
| `getOrderDetails` | Full details of one of the customer's own orders |
| `getPersonalizedRecommendations` | Recommendations from the customer's real order history (login required) |

---

## 🤝 Negotiation

DealAI negotiates on the **merchant's** behalf, and the merchant always keeps control. The AI proposes; the server decides.

- **Merchant constraints** — max discount %, minimum margin %, bundle rules, and round limits live in a `MerchantSettings` model.
- **Server-side validation** — every AI decision passes through a validation layer that clamps or rejects unsafe output.
- **Discount boundaries + minimum-margin protection** — the final price must satisfy **both** floors, using the stricter (higher) of:
  1. **Max-discount floor:** `cartTotal × (1 − maxDiscountPercent / 100)`
  2. **Min-margin floor:** `totalCost ÷ (1 − minimumMarginPercent / 100)`
- **AI output is never blindly trusted** — the model is given structured business context, but its price is validated against the floors on the server (or replaced by a deterministic fallback engine when the AI is unavailable or returns invalid output).
- **The AI cannot set the trusted final price** — it can only propose within bounds; the server computes and enforces the real number.
- **Deal acceptance is revalidated** — accepting a deal re-checks it against the current cart/state before it is locked in.

Internal fields such as `costPrice` and margin floors are **never** exposed to the AI context or the frontend.

---

## 💳 Payments — Razorpay Test Mode

> **Razorpay is currently configured for Test Mode.** No real money moves; this is not production/live payments.

```
Cart → Checkout → Razorpay Test Payment → Payment Verification → Order → My Orders
```

- The checkout total is always computed **server-side**.
- After payment, the Razorpay signature is **verified on the server** with an HMAC-SHA256 check before any order is created.
- If Razorpay keys are not configured, checkout cleanly reports "not configured" instead of faking a payment.

---

## 🏗️ Architecture

```
                    User
                     │
              React Frontend (Vite + Tailwind)
                     │
          Voice / Text Agent Interface
                     │
           Node.js + Express Backend
                     │
                Gemini Agent
                     │
          Controlled Agent Tools
                     │
                 MongoDB (Atlas)
                     │
        Cart · Negotiation · Checkout
                     │
             Razorpay Test Mode
                     │
              Order Management
```

The **backend remains authoritative** for everything that matters:

| Concern | Authority |
|---------|-----------|
| Identity / auth | Server (scrypt-hashed passwords, HMAC session tokens) |
| Product data | Server (MongoDB) — `costPrice` never exposed |
| Cart state | Validated server-side; client totals never trusted |
| Pricing | Computed on the server |
| Negotiation | Validated + clamped against merchant rules |
| Checkout totals | Recomputed on the server |
| Payment verification | HMAC-SHA256 signature check on the server |
| Orders | Created + read server-side, scoped to the owner |

---

## 🔐 Security & Trust

- **Secrets in environment variables** — API keys, DB URI, and auth/payment secrets live in `server/.env` (git-ignored), never in the frontend bundle.
- **Passwords hashed** — scrypt with a per-password random salt; the plaintext is never stored.
- **Sensitive fields excluded** — internal fields like product `costPrice` and margin floors are stripped from AI context and API responses.
- **Server-authoritative pricing** — the client can never dictate a price or total.
- **Negotiation validation** — AI negotiation output is clamped/rejected against merchant rules server-side.
- **Payment signature verification** — Razorpay payments are verified with a constant-time HMAC-SHA256 check before an order is created.
- **Authenticated protected operations** — orders and personal history require a valid session token; users only ever see their own data.

---

## 🧱 Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | React 19, Vite 8 |
| Styling | Tailwind CSS v4 |
| Icons | Lucide React |
| State | React Context + `useReducer` |
| Backend | Node.js, Express |
| Database | MongoDB Atlas + Mongoose |
| AI | Google Gemini |
| Payments | Razorpay (Test Mode) |
| Voice | Browser Web Speech API |
| Auth | Node `crypto` — scrypt password hashing + HMAC session tokens |

---

## 🎬 Demo Flow

> **You:** *"Mere liye 2000 ke andar best running shoes dhundo."*
> **DealAI:** searches real products within budget.
>
> **You:** *"Reviews compare karo aur best wala tum decide karo."*
> **DealAI:** compares options, analyzes reviews, and recommends the best pick.
>
> **You:** *"Cart me add karo."*
> **DealAI:** actually updates the cart.
>
> **You:** *"Cart ke saath kya useful rahega?"*
> **DealAI:** analyzes the cart and suggests complementary products.
>
> **You:** *"Best deal negotiate karo."*
> **DealAI:** runs a bounded negotiation within merchant rules.
>
> **You:** *"Deal accept karo aur checkout par le jao."*
> **DealAI:** revalidates and locks the deal, then proceeds to checkout.
>
> **Then:** Razorpay Test Mode → payment verified → **Order** created → visible in **My Orders**.

---

## 🚀 Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure the backend

```bash
cp server/.env.example server/.env
```

Set the values in `server/.env`:

| Variable | Required | Notes |
|----------|----------|-------|
| `PORT` | no | Defaults to `5000` |
| `CLIENT_ORIGIN` | no | Comma-separated allowed frontend origins; defaults to the Vite dev server |
| `MONGODB_URI` | **yes** | MongoDB Atlas connection string |
| `AI_API_KEY` | no | Google Gemini API key. Leave blank to run purely on the deterministic rules engine |
| `AI_MODEL` | no | e.g. `gemini-3.6-flash` |
| `AI_BASE_URL` | no | Gemini API root, e.g. `https://generativelanguage.googleapis.com/v1beta` |
| `AUTH_SECRET` | no | Secret for signing session tokens (HMAC). Blank → ephemeral per-process secret (dev only) |
| `RAZORPAY_KEY_ID` | no | Test-mode Key ID (`rzp_test_…`); public. Blank → online payment disabled |
| `RAZORPAY_KEY_SECRET` | no | Test-mode Key Secret; **server-only** |

> 🔒 **Never commit `.env` files or API secrets.** `AI_API_KEY`, `MONGODB_URI`, `AUTH_SECRET`, `RAZORPAY_KEY_SECRET`, and product `costPrice` are never exposed to the frontend.

### 3. Seed the database

```bash
npm run seed
```

Seeds the product catalogue and default merchant settings (max discount, min margin, bundle rules, negotiation rounds).

### 4. Run

```bash
npm run dev        # frontend (Vite)   → http://localhost:5173
npm run server     # backend (Express) → http://localhost:5000
npm run dev:all    # both together (concurrently)
```

### Useful commands

```bash
npm run build        # production frontend build
npm run lint         # oxlint
npm run test:server  # full server test suite (search, negotiation, auth, orders, payment, agent, Gemini)
```

---

## 📁 Project Structure

```
src/                              — Frontend (React + Vite + Tailwind)
├── components/
│   ├── VoiceAgent.jsx            — hands-free voice agent (SSE streaming + spoken replies)
│   ├── AgentPanel.jsx            — text chat agent panel
│   ├── CheckoutPage.jsx          — checkout + Razorpay flow
│   ├── OrdersPage.jsx / OrderDetailPage.jsx
│   ├── ProductGrid / ProductCard / ProductDetailModal / SearchPage / CategoryPage
│   ├── CartDrawer / CartItem · Navbar / Sidebar / Layout / Hero / Footer
│   └── AuthModal / ProfilePage / WishlistPage / DealModal
├── context/                      — Auth, Cart, Wishlist, UI, AgentActivity
├── hooks/useSpeechRecognition.js — Web Speech API wrapper
├── lib/                          — api.js (incl. SSE stream client), razorpay.js, session.js
└── data/products.js              — static display catalogue

server/                           — Backend (Node.js + Express)
├── config/                       — db.js (Mongoose), loadEnv.js
├── models/                       — Product, MerchantSettings, Deal, User, Order
├── routes/                       — agent, products, auth, cart, orders, payments, deals, wishlist
├── controllers/                  — request handlers per route group
├── services/
│   ├── agentService.js           — Gemini agent loop + streaming (runAgentStream)
│   ├── agentTools.js             — tool implementations + validateCartOp
│   ├── negotiationService.js     — bounded negotiation
│   ├── dealValidationService.js  — clamps/rejects unsafe AI output
│   ├── aiDealService.js / fallbackService.js — AI negotiator + deterministic fallback
│   ├── razorpayService.js        — order creation + HMAC signature verification
│   └── cartService.js            — server-side cart resolution
├── utils/                        — auth.js (scrypt + HMAC), calculations.js, searchQuery.js
├── middleware/auth.js            — optional/required session auth
├── seed/seedProducts.js          — products + merchant settings
├── test/                         — search, negotiation, auth, orders, payment, agent, Gemini suites
└── server.js                     — Express entry point
```

---

*Built for the Razorpay AI Buildathon · AI Growth & Agentic Commerce Track.*

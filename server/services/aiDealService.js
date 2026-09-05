// ─────────────────────────────────────────────────────────────────────────
// aiDealService.js — Gemini reasoning layer (provider abstraction)
//
// This is the ONLY file that talks to the Gemini AI provider for negotiation.
// The rest of the negotiation logic depends solely on:
//
//   isAiConfigured()          → boolean
//   getAiDecision(aiContext)  → Promise<rawDecision>
//
// Credentials and models are read ONLY from server/.env:
//
//   AI_API_KEY   — Gemini API key (SECRET)
//   AI_MODELS    — Comma-separated list of Gemini model ids (ordered fallback chain)
//   AI_BASE_URL  — Gemini API root (https://generativelanguage.googleapis.com/v1beta)
//
// AI output is NEVER trusted as a final price. It must pass through
// server-side deal validation before influencing a deal.
// ─────────────────────────────────────────────────────────────────────────

import { readEnv } from '../config/loadEnv.js';

const AI_TIMEOUT_MS = 30_000;
const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getApiKey() {
  return readEnv('AI_API_KEY');
}

function getModels() {
  const modelsStr = readEnv('AI_MODELS');
  if (modelsStr) {
    const list = modelsStr.split(',').map((s) => s.trim()).filter(Boolean);
    if (list.length > 0) return list;
  }
  const single = readEnv('AI_MODEL');
  if (single) return [single];
  return ['gemini-3.5-flash', 'gemini-3.5-flash-lite'];
}

function getBaseUrl() {
  const baseUrl = readEnv('AI_BASE_URL');
  return baseUrl ? baseUrl.replace(/\/+$/, '') : DEFAULT_BASE_URL;
}

/**
 * True when an AI API key is configured.
 */
export function isAiConfigured() {
  return Boolean(getApiKey());
}

const SYSTEM_PROMPT = `
You are DealAI, an autonomous negotiation agent acting on behalf of an e-commerce MERCHANT.

Your goal is to maximise the chance the customer completes the purchase WHILE protecting the merchant.

Never give away merchant value unnecessarily.

You receive a JSON context containing:
- cart products
- quantities
- original cart total
- customer's offer
- bundle information
- merchant negotiation rules
- current negotiation round
- light customer context

Reason about the offer and return STRICT JSON ONLY.

Required JSON shape:
{
  "decision": "ACCEPT" | "COUNTER_OFFER" | "REJECT",
  "counterPrice": number | null,
  "reason": string,
  "confidence": number
}

Rules:
- ACCEPT: Customer offer is good enough. counterPrice must be null.
- COUNTER_OFFER: Deal is possible but offer is too low. counterPrice > customer offer and <= cart total.
- REJECT: Offer is too low. counterPrice must be null.

Hard rules:
- Never propose a discount greater than merchantRules.maxDiscountPercent.
- counterPrice must be between cartTotal * (1 - maxDiscountPercent / 100) and cartTotal.
- If negotiationRound > merchantRules.maxNegotiationRounds, do NOT counter.
- reason must be one short customer-friendly sentence.
- NEVER mention cost price, merchant margin, internal pricing figures.
- confidence must be between 0 and 100.

Return ONLY the JSON object.
`;

/**
 * Robustly parse a JSON object from model output.
 */
export function parseDecision(text) {
  const cleaned = String(text ?? '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    // Continue with extraction.
  }

  const start = cleaned.indexOf('{');
  if (start === -1) {
    throw new Error('AI returned invalid JSON');
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (ch === '{') depth++;
      if (ch === '}') depth--;
      if (depth === 0) {
        const json = cleaned.slice(start, i + 1);
        try {
          return JSON.parse(json);
        } catch {
          break;
        }
      }
    }
  }

  throw new Error('AI returned invalid JSON');
}

function isRetryable(status, message = '') {
  if (typeof status === 'number') {
    if ([404, 429, 500, 502, 503, 504].includes(status)) return true;
  }
  const m = String(message).toLowerCase();
  return (
    m.includes('429') ||
    m.includes('resource_exhausted') ||
    m.includes('quota') ||
    m.includes('rate limit') ||
    m.includes('temporarily unavailable') ||
    m.includes('timeout') ||
    m.includes('aborted') ||
    m.includes('not_found') ||
    m.includes('no longer available')
  );
}

/**
 * One Gemini API attempt for negotiation.
 */
async function callGeminiOnce(model, aiContext, apiKey, baseUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

  const url = `${baseUrl}/models/${model}:generateContent?key=${apiKey}`;
  const body = {
    systemInstruction: {
      parts: [{ text: SYSTEM_PROMPT }],
    },
    contents: [
      {
        role: 'user',
        parts: [
          {
            text:
              'Negotiate this cart and respond with STRICT JSON only:\n' +
              JSON.stringify(aiContext),
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json',
    },
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      const errMsg = errData.error?.message || `HTTP ${res.status}`;
      const err = new Error(`Gemini HTTP ${res.status}: ${errMsg}`);
      err.status = res.status;
      err.retryable = isRetryable(res.status, errMsg);
      throw err;
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    if (!text.trim()) {
      const err = new Error('Gemini returned empty content');
      err.retryable = true;
      throw err;
    }

    try {
      return parseDecision(text);
    } catch (parseErr) {
      console.warn(`[DealAI][Gemini] JSON parse failed (len=${text.length}) — fallback`);
      parseErr.retryable = false;
      throw parseErr;
    }
  } catch (err) {
    if (err?.name === 'AbortError') {
      const timeoutErr = new Error('Gemini request timed out');
      timeoutErr.retryable = true;
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ask Gemini for a negotiation decision using multi-model failover.
 */
export async function getAiDecision(aiContext) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('AI API key not configured');
  }

  const baseUrl = getBaseUrl();
  const models = getModels();

  let lastError;
  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    console.log(`[DealAI][Gemini] model=${model}`);
    console.log(`[DealAI][Gemini] request`);
    try {
      const result = await callGeminiOnce(model, aiContext, apiKey, baseUrl);
      console.log(`[DealAI][Gemini] success`);
      return result;
    } catch (err) {
      lastError = err;
      console.warn(`[DealAI][Gemini] failed status=${err.status || err.message}`);
      if (err.retryable && i + 1 < models.length) {
        console.log(`[DealAI][Gemini] switching_to=${models[i + 1]}`);
        await sleep(300);
        continue;
      }
      throw err;
    }
  }
  console.log(`[DealAI][Gemini] deterministic_fallback`);
  throw lastError;
}
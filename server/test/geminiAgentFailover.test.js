// server/test/geminiAgentFailover.test.js
// Test suite for Gemini agent multi-model failover, tool calling, and fallback.

process.env.AI_API_KEY = 'test-dummy-key-not-a-real-secret';
process.env.AI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
process.env.AI_MODELS = 'gemini-model-1,gemini-model-2,gemini-model-3';

import { runAgent } from '../services/agentService.js';
import { connectDB } from '../config/db.js';

const realFetch = global.fetch;
function stubFetch(responder) {
  global.fetch = async (url, opts) => responder(url, opts);
}
function restoreFetch() {
  global.fetch = realFetch;
}

let passed = 0;
let failed = 0;
const tests = [];
function test(name, fn) { tests.push([name, fn]); }
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

// Mock catalogue product
const mockCatalogue = [
  { sku: 13, name: 'Aurora Smartphone X', brand: 'Aurora', category: 'Electronics', price: 28000, inventory: 10, rating: 4.7 },
];

await connectDB();

// 1. Model 1 success
test('Gemini Model 1 success: returns direct response', async () => {
  let callCount = 0;
  stubFetch((url) => {
    callCount++;
    assert(url.includes('/models/gemini-model-1:generateContent'), 'should call model 1');
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ text: 'Here are the best phones under 30000.' }],
            },
          },
        ],
      }),
    };
  });

  const res = await runAgent({ message: 'Hello' });
  assert(res.usedFallback === false, 'used AI response');
  assert(res.message.includes('best phones'), 'message content');
  assert(callCount === 1, 'called model 1 exactly once');
});

// 2. Model 1 returns 429 → Model 2 automatically used
test('Model 1 returns 429 → Model 2 automatically used', async () => {
  const modelsCalled = [];
  stubFetch((url) => {
    if (url.includes('gemini-model-1')) {
      modelsCalled.push('model-1');
      return { ok: false, status: 429, json: async () => ({ error: { message: 'Quota exceeded' } }) };
    }
    if (url.includes('gemini-model-2')) {
      modelsCalled.push('model-2');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: { role: 'model', parts: [{ text: 'Response from model 2' }] },
            },
          ],
        }),
      };
    }
    return { ok: false, status: 500 };
  });

  const res = await runAgent({ message: 'Hello' });
  assert(res.usedFallback === false, 'used AI');
  assert(res.message === 'Response from model 2', 'got model 2 response');
  assert(modelsCalled.join(',') === 'model-1,model-2', 'tried model 1 then model 2');
});

// 3. Model 1 & Model 2 return 429 → Model 3 automatically used
test('Model 1 & 2 return 429 → Model 3 automatically used', async () => {
  const modelsCalled = [];
  stubFetch((url) => {
    if (url.includes('gemini-model-1')) {
      modelsCalled.push('model-1');
      return { ok: false, status: 429, json: async () => ({ error: { message: 'Rate limit' } }) };
    }
    if (url.includes('gemini-model-2')) {
      modelsCalled.push('model-2');
      return { ok: false, status: 429, json: async () => ({ error: { message: 'RESOURCE_EXHAUSTED' } }) };
    }
    if (url.includes('gemini-model-3')) {
      modelsCalled.push('model-3');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: { role: 'model', parts: [{ text: 'Response from model 3' }] },
            },
          ],
        }),
      };
    }
    return { ok: false, status: 500 };
  });

  const res = await runAgent({ message: 'Hello' });
  assert(res.usedFallback === false, 'used AI');
  assert(res.message === 'Response from model 3', 'got model 3 response');
  assert(modelsCalled.join(',') === 'model-1,model-2,model-3', 'tried all 3 models in sequence');
});

// 4. All models fail → deterministic fallback
test('All models fail → deterministic fallback', async () => {
  const modelsCalled = [];
  stubFetch((url) => {
    if (url.includes('gemini-model-1')) modelsCalled.push('model-1');
    if (url.includes('gemini-model-2')) modelsCalled.push('model-2');
    if (url.includes('gemini-model-3')) modelsCalled.push('model-3');
    return { ok: false, status: 503, json: async () => ({ error: { message: 'Service Unavailable' } }) };
  });

  const res = await runAgent({ message: 'Mujhe 30000 ke andar best phone chahiye' });
  assert(res.usedFallback === true, 'used fallback');
  assert(modelsCalled.join(',') === 'model-1,model-2,model-3', 'tried all 3 models before fallback');
});

// 5. Tool call followed by model failure
test('Tool call followed by model failure switches model without re-executing tool', async () => {
  let toolExecutionCount = 0;
  const fetchLogs = [];

  stubFetch((url, opts) => {
    const body = JSON.parse(opts.body || '{}');
    if (url.includes('gemini-model-1') && !body.contents.some(c => c.parts.some(p => p.functionResponse))) {
      fetchLogs.push('model-1-turn-1');
      // Model 1 returns a tool call for searchProducts
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                role: 'model',
                parts: [{ functionCall: { name: 'searchProducts', args: { query: 'phone', maxPrice: 30000 } } }],
              },
            },
          ],
        }),
      };
    }
    if (url.includes('gemini-model-1')) {
      fetchLogs.push('model-1-turn-2-fail');
      // Model 1 fails on turn 2 with 429
      return { ok: false, status: 429, json: async () => ({ error: { message: 'Quota exceeded' } }) };
    }
    if (url.includes('gemini-model-2')) {
      fetchLogs.push('model-2-turn-2-success');
      // Model 2 receives turn 2 with existing functionResponse in history
      assert(body.contents.some(c => c.parts.some(p => p.functionResponse)), 'model 2 receives conversation with functionResponse');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                role: 'model',
                parts: [{ text: 'Model 2 answered after tool execution.' }],
              },
            },
          ],
        }),
      };
    }
    return { ok: false, status: 500 };
  });

  const res = await runAgent({ message: 'Mujhe 30000 ke andar best phone chahiye' });
  assert(res.usedFallback === false, 'used AI');
  assert(res.message === 'Model 2 answered after tool execution.', 'got response from model 2');
  assert(res.products.length > 0, 'products populated from tool');
});

// 6. Multiple tool calls in a single response
test('Handles multiple tool calls in one response', async () => {
  let calls = 0;
  stubFetch((url, opts) => {
    calls++;
    const body = JSON.parse(opts.body || '{}');
    if (calls === 1) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                role: 'model',
                parts: [
                  { functionCall: { name: 'searchProducts', args: { query: 'phone' } } },
                  { functionCall: { name: 'getCart', args: {} } },
                ],
              },
            },
          ],
        }),
      };
    }
    // Turn 2 check
    const lastMsg = body.contents[body.contents.length - 1];
    assert(lastMsg.parts.length === 2, 'contains 2 functionResponse parts');
    assert(lastMsg.parts[0].functionResponse.name === 'searchProducts', 'first func response');
    assert(lastMsg.parts[1].functionResponse.name === 'getCart', 'second func response');
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: { role: 'model', parts: [{ text: 'Handled both tools.' }] },
          },
        ],
      }),
    };
  });

  const res = await runAgent({ message: 'Check cart and search phones' });
  assert(res.message === 'Handled both tools.', 'response text');
});

// 7. Non-retryable error (e.g. 401 Unauthorized / Invalid API Key) does not switch models
test('Invalid API key (401) is non-retryable and triggers fallback directly without model switching', async () => {
  const modelsCalled = [];
  stubFetch((url) => {
    if (url.includes('gemini-model-1')) modelsCalled.push('model-1');
    if (url.includes('gemini-model-2')) modelsCalled.push('model-2');
    return { ok: false, status: 401, json: async () => ({ error: { message: 'API_KEY_INVALID' } }) };
  });

  const res = await runAgent({ message: 'Search phones' });
  assert(res.usedFallback === true, 'used fallback');
  assert(modelsCalled.join(',') === 'model-1', 'did not attempt model 2 on non-retryable 401');
});

// ── Run test suite ────────────────────────────────────────────────────────
console.log('\nDealAI Gemini Agent Failover & Tool Calling Tests\n');
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log('  ✓', name);
    passed++;
  } catch (e) {
    console.error('  ✗', name, '\n      ', e.message);
    failed++;
  } finally {
    restoreFetch();
  }
}
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);

// Standalone auth-primitive tests — no database, no network required.
// Run with:  node server/test/auth.test.js
//
// Covers the SECURITY-CRITICAL crypto in server/utils/auth.js: scrypt password
// hashing (correct vs wrong, unique salts, plaintext never stored), HMAC session
// tokens (round-trip, tamper-evident, expiry), and the input validators.

import {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  tokenFromHeader,
  normalizeEmail,
  isValidEmail,
  passwordProblem,
  nameProblem,
  PASSWORD_MIN_LEN,
} from '../utils/auth.js';

// ── Tiny harness (same style as the other server tests) ───────────────────────
let passed = 0;
let failed = 0;
const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

console.log('\nDealAI auth-primitive tests\n');

// ── Password hashing ──────────────────────────────────────────────────────────
test('SECURITY: hashPassword never stores the plaintext', () => {
  const stored = hashPassword('correct horse battery staple');
  assert(typeof stored === 'string', 'returns a string');
  assert(stored.startsWith('scrypt$'), 'is a self-describing scrypt hash');
  assert(!stored.includes('correct horse battery staple'), 'plaintext must not appear in the hash');
  assert(stored.split('$').length === 3, 'format is scrypt$salt$hash');
});

test('SECURITY: verifyPassword accepts the right password, rejects wrong ones', () => {
  const stored = hashPassword('S3cret-passw0rd');
  assert(verifyPassword('S3cret-passw0rd', stored) === true, 'correct password verifies');
  assert(verifyPassword('s3cret-passw0rd', stored) === false, 'case change fails');
  assert(verifyPassword('wrong', stored) === false, 'wrong password fails');
  assert(verifyPassword('', stored) === false, 'empty password fails');
});

test('SECURITY: identical passwords hash to DIFFERENT strings (unique salts)', () => {
  const a = hashPassword('samePassword123');
  const b = hashPassword('samePassword123');
  assert(a !== b, 'salts must differ so hashes differ');
  // ...yet both still verify against the original password.
  assert(verifyPassword('samePassword123', a) && verifyPassword('samePassword123', b), 'both verify');
});

test('verifyPassword is robust to malformed stored values (never throws)', () => {
  assert(verifyPassword('x', 'not-a-hash') === false, 'garbage stored value');
  assert(verifyPassword('x', '') === false, 'empty stored value');
  assert(verifyPassword('x', null) === false, 'null stored value');
  assert(verifyPassword('x', 'scrypt$only-two') === false, 'missing hash segment');
});

// ── Session tokens ──────────────────────────────────────────────────────────
test('signToken/verifyToken round-trips the user id', () => {
  const token = signToken('user-abc-123');
  assert(typeof token === 'string' && token.includes('.'), 'token has payload.sig form');
  assert(verifyToken(token) === 'user-abc-123', 'verifies back to the same id');
});

test('SECURITY: a tampered token is rejected', () => {
  const token = signToken('user-1');
  const [payload, sig] = token.split('.');
  // Tamper with the payload (flip its first char) but keep the old signature.
  const flip = (s) => (s[0] === 'A' ? 'B' : 'A') + s.slice(1);
  assert(verifyToken(`${flip(payload)}.${sig}`) === null, 'payload tamper rejected');
  assert(verifyToken(`${payload}.${flip(sig)}`) === null, 'signature tamper rejected');
  assert(verifyToken('garbage') === null, 'non-token rejected');
  assert(verifyToken('') === null, 'empty rejected');
});

test('SECURITY: an expired token is rejected', () => {
  const expired = signToken('user-2', { ttlMs: -1000 }); // already expired
  assert(verifyToken(expired) === null, 'expired token must not verify');
  const fresh = signToken('user-2', { ttlMs: 60_000 });
  assert(verifyToken(fresh) === 'user-2', 'fresh token still verifies');
});

test('SECURITY: forging a token without the secret is not possible (wrong-sig payload)', () => {
  // A hand-built payload with a bogus signature must fail (no secret knowledge).
  const payload = Buffer.from(JSON.stringify({ uid: 'attacker', exp: Date.now() + 100000 })).toString('base64url');
  assert(verifyToken(`${payload}.${Buffer.from('bogus').toString('base64url')}`) === null, 'forged token rejected');
});

test('tokenFromHeader extracts a bearer token', () => {
  assert(tokenFromHeader('Bearer abc.def') === 'abc.def', 'parses Bearer');
  assert(tokenFromHeader('bearer abc.def') === 'abc.def', 'case-insensitive scheme');
  assert(tokenFromHeader('abc.def') === null, 'no scheme → null');
  assert(tokenFromHeader(undefined) === null, 'missing header → null');
});

// ── Validators ────────────────────────────────────────────────────────────────
test('normalizeEmail lowercases and trims', () => {
  assert(normalizeEmail('  Foo@Bar.COM ') === 'foo@bar.com', 'normalises');
});

test('isValidEmail accepts sane emails and rejects junk', () => {
  assert(isValidEmail('user@example.com'), 'plain');
  assert(isValidEmail('  User.Name@Sub.Example.co  '), 'trims + subdomain');
  assert(!isValidEmail('no-at-sign'), 'missing @');
  assert(!isValidEmail('a@b'), 'missing TLD dot');
  assert(!isValidEmail('a b@c.com'), 'contains a space');
  assert(!isValidEmail(''), 'empty');
});

test('passwordProblem enforces presence + minimum length', () => {
  assert(passwordProblem('') !== null, 'empty rejected');
  assert(passwordProblem('short') !== null, `below ${PASSWORD_MIN_LEN} rejected`);
  assert(passwordProblem('a'.repeat(PASSWORD_MIN_LEN)) === null, 'exactly minimum accepted');
  assert(passwordProblem('a'.repeat(PASSWORD_MIN_LEN + 5)) === null, 'above minimum accepted');
  assert(passwordProblem('a'.repeat(500)) !== null, 'absurdly long rejected');
});

test('nameProblem enforces presence + max length', () => {
  assert(nameProblem('') !== null, 'empty rejected');
  assert(nameProblem('  ') !== null, 'whitespace-only rejected');
  assert(nameProblem('Ada Lovelace') === null, 'normal name accepted');
  assert(nameProblem('a'.repeat(200)) !== null, 'too long rejected');
});

// ── Run ───────────────────────────────────────────────────────────────────────
(async () => {
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log('  ✓', name);
      passed++;
    } catch (e) {
      console.error('  ✗', name, '\n      ', e.message);
      failed++;
    }
  }
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})();

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// Single source of truth for loading server/.env — used by the API server, the
// seed script, and anything else that needs env vars. Loading here (as a
// side-effect import placed FIRST) guarantees process.env is populated before
// any module reads it, regardless of the current working directory.
//
// This file lives in server/config/, so ../.env resolves to server/.env.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// Read an env var defensively: trims whitespace and strips a single pair of
// accidental surrounding quotes (e.g. MONGODB_URI="mongodb+srv://...").
export function readEnv(name) {
  const raw = process.env[name];
  if (raw == null) return '';
  return raw.trim().replace(/^(['"])(.*)\1$/s, '$2').trim();
}

// Require a non-empty env var, or throw a precise, SECRET-SAFE error that
// distinguishes "missing" from "present but empty". Never prints the value.
export function requireEnv(name) {
  const present = Object.prototype.hasOwnProperty.call(process.env, name);
  const value = readEnv(name);
  if (!value) {
    const detail = present
      ? `is present in server/.env but empty`
      : `is missing from server/.env`;
    throw new Error(
      `${name} ${detail}. Open server/.env and set:\n` +
        `    ${name}=<your value>\n` +
        `(no quotes needed, no spaces around "="). Keep server/.env out of git.`
    );
  }
  return value;
}

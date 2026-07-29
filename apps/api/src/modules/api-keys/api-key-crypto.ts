import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Public key prefix used for DB lookup (unique). */
export const API_KEY_PREFIX_LENGTH = 12;

/** Secret entropy (bytes) before base64url encoding. */
const SECRET_BYTES = 24;

/**
 * Full key format: `fnk_live_<prefix>_<secret>`
 * - prefix: URL-safe, unique, stored plaintext for lookup
 * - secret: never stored; only HMAC-SHA256(pepper, secret) is persisted
 */
export function generateApiKeyMaterial(): {
  prefix: string;
  secret: string;
  rawKey: string;
} {
  // Hex prefix — fixed length, no `_`, so parse is unambiguous even if secret is base64url.
  const prefix = randomBytes(Math.ceil(API_KEY_PREFIX_LENGTH / 2))
    .toString('hex')
    .slice(0, API_KEY_PREFIX_LENGTH);
  const secret = randomBytes(SECRET_BYTES).toString('base64url');
  const rawKey = `fnk_live_${prefix}_${secret}`;
  return { prefix, secret, rawKey };
}

export function parseApiKey(rawKey: string): { prefix: string; secret: string } | null {
  const trimmed = rawKey.trim();
  const head = 'fnk_live_';
  if (!trimmed.startsWith(head)) {
    return null;
  }
  // Fixed-width prefix — do not split on `_` (base64url secrets may contain `_`).
  const prefix = trimmed.slice(head.length, head.length + API_KEY_PREFIX_LENGTH);
  const sep = trimmed[head.length + API_KEY_PREFIX_LENGTH];
  const secret = trimmed.slice(head.length + API_KEY_PREFIX_LENGTH + 1);
  if (
    prefix.length !== API_KEY_PREFIX_LENGTH ||
    sep !== '_' ||
    !secret ||
    !/^[a-f0-9]+$/i.test(prefix) ||
    !/^[A-Za-z0-9_-]+$/.test(secret)
  ) {
    return null;
  }
  return { prefix, secret };
}

export function hashApiKeySecret(secret: string, pepper: string): string {
  return createHmac('sha256', pepper).update(secret, 'utf8').digest('hex');
}

export function verifyApiKeySecret(input: {
  secret: string;
  secretHash: string;
  pepper: string;
}): boolean {
  const expected = hashApiKeySecret(input.secret, input.pepper);
  try {
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(input.secretHash, 'utf8');
    if (a.length !== b.length) {
      return false;
    }
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** Masked display for list endpoints — never reveals the secret. */
export function maskApiKeyPrefix(prefix: string): string {
  return `fnk_live_${prefix}_****`;
}

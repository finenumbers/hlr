import { SetMetadata } from '@nestjs/common';

/**
 * Public API / auth rate-limit zones (separate Redis buckets).
 * - auth: login/logout (IP-keyed via IpRateLimitGuard)
 * - submit: POST /v1/checks, POST /v1/jobs (expensive; uses tenant/key RPM)
 * - webhook: /v1/webhooks* (+ sensitive key mutations)
 * - read: GET polling / list / me / balance
 */
export type RateLimitZone = 'auth' | 'submit' | 'webhook' | 'read';

export const RATE_LIMIT_ZONE_KEY = 'rateLimitZone';

/** Mark a handler/controller with an API-key rate-limit zone. */
export const ApiRateLimitZone = (zone: Exclude<RateLimitZone, 'auth'>) =>
  SetMetadata(RATE_LIMIT_ZONE_KEY, zone);

export const SUBMIT_PATH_PREFIXES = ['/v1/checks', '/v1/jobs'] as const;

/** Paths that accept the larger submit body limit (POST only). */
export function isSubmitWritePath(method: string, path: string): boolean {
  if (method.toUpperCase() !== 'POST') {
    return false;
  }
  const normalized = path.split('?')[0] || '/';
  // Exact create routes — not GET /v1/checks/:id style.
  if (normalized === '/v1/checks' || normalized === '/v1/jobs') {
    return true;
  }
  return false;
}

/** Multipart CSV upload / preview routes (POST only) — use BODY_LIMIT_CSV. */
export function isCsvUploadPath(method: string, path: string): boolean {
  if (method.toUpperCase() !== 'POST') {
    return false;
  }
  const normalized = path.split('?')[0] || '/';
  return (
    normalized === '/cabinet/csv-previews' ||
    normalized === '/cabinet/jobs/csv' ||
    normalized === '/v1/jobs/csv'
  );
}

/**
 * Parse express-style size strings: 1mb, 256kb, 1024, etc.
 */
export function parseSizeToBytes(value: string): number {
  const trimmed = value.trim().toLowerCase();
  const match = /^(\d+(?:\.\d+)?)(b|kb|mb|gb)?$/.exec(trimmed);
  if (!match) {
    throw new Error(`Invalid size value: ${value}`);
  }
  const amount = Number(match[1]);
  const unit = match[2] ?? 'b';
  const multipliers: Record<string, number> = {
    b: 1,
    kb: 1024,
    mb: 1024 * 1024,
    gb: 1024 * 1024 * 1024,
  };
  return Math.floor(amount * (multipliers[unit] ?? 1));
}

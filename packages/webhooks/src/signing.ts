import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Signature scheme (v1):
 *   signed_payload = `${timestamp}.${rawBody}`
 *   signature = HMAC-SHA256(secret, signed_payload) hex
 * Header:
 *   X-Finenumbers-Signature: t=<unix_seconds>,v1=<hex>
 */
export function signWebhookPayload(input: {
  secret: string;
  rawBody: string;
  timestampSec?: number;
}): { header: string; timestampSec: number; signature: string } {
  const timestampSec = input.timestampSec ?? Math.floor(Date.now() / 1000);
  const signedPayload = `${timestampSec}.${input.rawBody}`;
  const signature = createHmac('sha256', input.secret)
    .update(signedPayload, 'utf8')
    .digest('hex');
  return {
    header: `t=${timestampSec},v1=${signature}`,
    timestampSec,
    signature,
  };
}

export function parseSignatureHeader(header: string): {
  timestampSec: number;
  signature: string;
} | null {
  const parts = header.split(',').map((p) => p.trim());
  let timestampSec: number | undefined;
  let signature: string | undefined;
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const key = part.slice(0, eq);
    const value = part.slice(eq + 1);
    if (key === 't') {
      const n = Number(value);
      if (Number.isFinite(n)) timestampSec = n;
    } else if (key === 'v1') {
      signature = value;
    }
  }
  if (timestampSec === undefined || !signature) {
    return null;
  }
  return { timestampSec, signature };
}

export function verifyWebhookSignature(input: {
  secret: string;
  rawBody: string;
  header: string;
  /** Reject signatures older/newer than this window (seconds). Default 5 minutes. */
  toleranceSec?: number;
  nowSec?: number;
}): boolean {
  const parsed = parseSignatureHeader(input.header);
  if (!parsed) {
    return false;
  }
  const tolerance = input.toleranceSec ?? 300;
  const now = input.nowSec ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - parsed.timestampSec) > tolerance) {
    return false;
  }
  const expected = signWebhookPayload({
    secret: input.secret,
    rawBody: input.rawBody,
    timestampSec: parsed.timestampSec,
  }).signature;
  try {
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(parsed.signature, 'utf8');
    if (a.length !== b.length) {
      return false;
    }
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

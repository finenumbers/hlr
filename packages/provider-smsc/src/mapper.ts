import { createHash } from 'node:crypto';

import type {
  NormalizedResult,
  ProviderCheckType,
  ProviderLifecycleStatus,
  ProviderResultStatus,
} from '@finenumbers/provider-core';

import type { SmscCallbackPayload, SmscStatusBody } from './types.js';

const PROVIDER_CODE = 'smsc';

function emptyNormalized(
  checkType: ProviderCheckType,
  overrides: Partial<NormalizedResult> = {},
): NormalizedResult {
  return {
    providerCode: PROVIDER_CODE,
    checkType,
    providerMessageId: null,
    phoneE164: null,
    lifecycleStatus: 'pending',
    resultStatus: 'pending',
    isReachable: null,
    imsi: null,
    mcc: null,
    mnc: null,
    operatorName: null,
    countryCode: null,
    ported: null,
    roaming: null,
    providerErrorCode: null,
    providerErrorMessage: null,
    providerStatusCode: null,
    cost: null,
    currency: null,
    extras: {},
    ...overrides,
  };
}

function asString(value: unknown): string | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  return String(value);
}

function asNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizePhoneHint(phone: string | null | undefined): string | null {
  if (!phone) {
    return null;
  }
  const digits = phone.trim().replace(/^\+/, '');
  if (!digits) {
    return null;
  }
  return phone.startsWith('+') ? phone : `+${digits}`;
}

/**
 * Map SMSC status / err codes into lifecycle + reachability.
 *
 * Conservative rules (SMSC docs):
 * - status -1,-2,0 → pending
 * - status -3 → failed (not found)
 * - status 1,2 → completed; reachability from err when present
 * - status 3,20+ → completed with unreachable / error (provider delivered a terminal outcome)
 * - err 0 with terminal success status → reachable
 * - err non-zero on HLR/Ping often means unavailable / not delivered
 */
export function mapProviderStatus(input: {
  checkType: ProviderCheckType;
  statusCode: string | number | null | undefined;
  errorCode?: string | number | null;
  errorMessage?: string | null;
  phoneE164?: string | null;
  providerMessageId?: string | null;
  extras?: Record<string, unknown>;
  cost?: string | null;
  currency?: string | null;
}): NormalizedResult {
  const status = asNumber(input.statusCode);
  const err = asNumber(input.errorCode);
  const extras = { ...(input.extras ?? {}) };

  let lifecycleStatus: ProviderLifecycleStatus = 'pending';
  let resultStatus: ProviderResultStatus = 'pending';
  let isReachable: boolean | null = null;

  if (status === null && err === null && !input.errorMessage) {
    return emptyNormalized(input.checkType, {
      phoneE164: input.phoneE164 ?? null,
      providerMessageId: asString(input.providerMessageId),
      lifecycleStatus: 'pending',
      resultStatus: 'unknown',
      extras,
      cost: input.cost ?? null,
      currency: input.currency ?? null,
    });
  }

  if (status === -3) {
    lifecycleStatus = 'failed';
    resultStatus = 'error';
  } else if (status === -1 || status === -2 || status === 0) {
    lifecycleStatus = 'pending';
    resultStatus = 'pending';
  } else if (status === 1 || status === 2) {
    lifecycleStatus = 'completed';
    if (err === null || err === 0) {
      resultStatus = 'reachable';
      isReachable = true;
    } else {
      // Terminal delivery with HLR/Ping error → treat as completed unreachable.
      resultStatus = 'unreachable';
      isReachable = false;
    }
  } else if (status !== null && status >= 3) {
    lifecycleStatus = 'completed';
    resultStatus = 'unreachable';
    isReachable = false;
  } else if (input.errorMessage || err !== null) {
    lifecycleStatus = 'failed';
    resultStatus = 'error';
  }

  return emptyNormalized(input.checkType, {
    phoneE164: input.phoneE164 ?? null,
    providerMessageId: asString(input.providerMessageId),
    lifecycleStatus,
    resultStatus,
    isReachable,
    providerStatusCode: status !== null ? String(status) : null,
    providerErrorCode: err !== null ? String(err) : asString(input.errorCode),
    providerErrorMessage: input.errorMessage ?? null,
    cost: input.cost ?? null,
    currency: input.currency ?? null,
    extras,
  });
}

function extractHlrFields(body: SmscStatusBody): Partial<NormalizedResult> {
  const mcc = asString(body.mcc);
  const mnc = asString(body.mnc);
  const rcn = asString(body.rcn);
  const rnet = asString(body.rnet);
  const cn = asString(body.cn);
  const net = asString(body.net);

  let roaming: boolean | null = null;
  if (rcn || rnet) {
    roaming = true;
  } else if (cn || net || mcc || mnc) {
    // Have home network info but no roaming fields → not confidently roaming.
    roaming = false;
  }

  const extras: Record<string, unknown> = {};
  if (body.msc !== undefined) {
    extras.msc = asString(body.msc);
  }
  if (rcn) {
    extras.roamingCountry = rcn;
  }
  if (rnet) {
    extras.roamingOperator = rnet;
  }
  if (body.type !== undefined) {
    extras.messageType = asNumber(body.type) ?? body.type;
  }
  if (body.flag !== undefined) {
    extras.flag = body.flag;
  }

  return {
    imsi: asString(body.imsi),
    mcc,
    mnc,
    operatorName: net,
    countryCode: cn,
    roaming,
    // Ported is not a reliable boolean in SMSC payloads without extra flags — leave null.
    ported: null,
    extras,
  };
}

/**
 * Unified pipeline for send-ack, status.php, and callback bodies.
 */
export function mapProviderResponse(input: {
  checkType: ProviderCheckType;
  raw: unknown;
  phoneE164?: string | null;
  providerMessageId?: string | null;
  currency?: string | null;
}): NormalizedResult {
  const raw = input.raw;
  if (!raw || typeof raw !== 'object') {
    return emptyNormalized(input.checkType, {
      phoneE164: input.phoneE164 ?? null,
      providerMessageId: input.providerMessageId ?? null,
      lifecycleStatus: 'failed',
      resultStatus: 'error',
      providerErrorMessage: 'Empty or non-object provider response',
    });
  }

  const body = raw as SmscStatusBody & {
    error?: string;
    error_code?: number | string;
    cnt?: number | string;
    balance?: string | number;
  };

  // API-level error (send/cost/status failure)
  if (body.error_code !== undefined && body.error_code !== null && body.error_code !== '') {
    return emptyNormalized(input.checkType, {
      phoneE164: input.phoneE164 ?? null,
      providerMessageId: asString(body.id) ?? input.providerMessageId ?? null,
      lifecycleStatus: 'failed',
      resultStatus: 'error',
      providerErrorCode: String(body.error_code),
      providerErrorMessage: body.error ?? null,
      cost: asString(body.cost),
      currency: input.currency ?? null,
    });
  }

  const providerMessageId =
    asString(body.id) ?? input.providerMessageId ?? null;
  const phoneE164 =
    normalizePhoneHint(asString(body.phone) ?? undefined) ?? input.phoneE164 ?? null;

  // Send acknowledgement: id present, no status field yet.
  if (body.id !== undefined && body.status === undefined && body.err === undefined) {
    return emptyNormalized(input.checkType, {
      phoneE164,
      providerMessageId,
      lifecycleStatus: 'accepted',
      resultStatus: 'pending',
      cost: asString(body.cost),
      currency: input.currency ?? null,
      extras: {
        ...(body.cnt !== undefined ? { cnt: asNumber(body.cnt) ?? body.cnt } : {}),
        ...(body.balance !== undefined ? { balance: asString(body.balance) } : {}),
      },
    });
  }

  const hlr = extractHlrFields(body);
  const statusMapped = mapProviderStatus({
    checkType: input.checkType,
    statusCode: body.status,
    errorCode: body.err,
    errorMessage: body.error ?? null,
    phoneE164,
    providerMessageId,
    cost: asString(body.cost),
    currency: input.currency ?? null,
    extras: hlr.extras ?? {},
  });

  return {
    ...statusMapped,
    imsi: hlr.imsi ?? statusMapped.imsi,
    mcc: hlr.mcc ?? statusMapped.mcc,
    mnc: hlr.mnc ?? statusMapped.mnc,
    operatorName: hlr.operatorName ?? statusMapped.operatorName,
    countryCode: hlr.countryCode ?? statusMapped.countryCode,
    roaming: hlr.roaming ?? statusMapped.roaming,
    ported: hlr.ported ?? statusMapped.ported,
    extras: { ...statusMapped.extras, ...(hlr.extras ?? {}) },
  };
}

export function callbackDedupeKey(payload: unknown): string {
  const body = (payload && typeof payload === 'object' ? payload : {}) as SmscCallbackPayload;
  const material = [
    asString(body.id) ?? '',
    asString(body.phone) ?? '',
    asString(body.status) ?? '',
    asString(body.err) ?? '',
    asString(body.ts) ?? asString(body.time) ?? '',
  ].join('|');
  return createHash('sha256').update(material).digest('hex');
}

/**
 * SMSC callback signature: md5/sha1 of `id:phone:status:<secret>`.
 */
export function verifyCallbackSignature(input: {
  payload: SmscCallbackPayload;
  secret: string;
  signatures?: { md5?: string; sha1?: string; crc32?: string };
}): boolean | null {
  if (!input.secret) {
    return null;
  }

  const id = asString(input.payload.id) ?? '';
  const phone = asString(input.payload.phone) ?? '';
  const status = asString(input.payload.status) ?? '';
  const base = `${id}:${phone}:${status}:${input.secret}`;

  const md5 =
    input.signatures?.md5 ?? asString(input.payload.md5) ?? undefined;
  const sha1 =
    input.signatures?.sha1 ?? asString(input.payload.sha1) ?? undefined;

  if (!md5 && !sha1) {
    return false;
  }

  if (md5) {
    const expected = createHash('md5').update(base).digest('hex');
    if (expected.toLowerCase() !== md5.toLowerCase()) {
      return false;
    }
  }
  if (sha1) {
    const expected = createHash('sha1').update(base).digest('hex');
    if (expected.toLowerCase() !== sha1.toLowerCase()) {
      return false;
    }
  }
  return true;
}

/**
 * Map idempotency key to SMSC numeric `id` (positive 31-bit).
 * SMSC accepts client-assigned ids for dedupe of outbound sends.
 */
export function smscClientIdFromKey(idempotencyKey: string): number {
  const digest = createHash('sha256').update(idempotencyKey).digest();
  // Take first 4 bytes as unsigned, clear high bit → (0, 2^31-1]
  const value = digest.readUInt32BE(0) & 0x7fffffff;
  return value === 0 ? 1 : value;
}

export { PROVIDER_CODE };

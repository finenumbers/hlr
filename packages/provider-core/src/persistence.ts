import type { NormalizedResult, ProviderCheckType } from './types.js';

export type ProviderRequestKind = 'SEND' | 'STATUS' | 'COST' | 'BALANCE' | 'OTHER';

export type ProviderRequestRecordStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED';

/**
 * Outbound call record. Application layer persists via Prisma (or test doubles).
 *
 * Always keep the three artefacts separate when available:
 * - requestPayload (raw request, secrets redacted)
 * - responsePayload (raw response)
 * - normalizedResult (mapping snapshot at write time)
 */
export type ProviderRequestRecord = {
  id?: string;
  tenantId: string;
  jobItemId?: string | null;
  providerCode: string;
  kind: ProviderRequestKind;
  status: ProviderRequestRecordStatus;
  providerMessageId?: string | null;
  httpStatus?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  /** Safe-to-store request (secrets redacted by adapter before handoff). */
  requestPayload: unknown;
  responsePayload?: unknown | null;
  normalizedResult?: NormalizedResult | null;
  /**
   * Application-level idempotency key (e.g. SEND:HLR:<jobItemId>).
   * Persistence implementations should enforce uniqueness among PENDING/SUCCEEDED.
   */
  idempotencyKey?: string | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
};

export type ProviderCallbackRecord = {
  id?: string;
  tenantId?: string | null;
  jobItemId?: string | null;
  providerCode: string;
  providerMessageId?: string | null;
  rawPayload: unknown;
  normalizedResult?: NormalizedResult | null;
  signatureValid?: boolean | null;
  /**
   * Stable fingerprint for callback dedupe (hash of relevant payload fields).
   */
  dedupeKey?: string | null;
  processError?: string | null;
  processedAt?: Date | null;
};

export type SaveRequestResult = {
  id: string;
  /** Existing row reused (idempotent send). */
  deduplicated: boolean;
};

export type SaveCallbackResult = {
  id: string;
  deduplicated: boolean;
};

/**
 * Persistence hooks for the adapter. Implementations live in apps (Prisma),
 * not inside provider packages — keeps packages free of Nest/DB coupling.
 */
export interface ProviderPersistencePort {
  /**
   * Create (or return existing) outbound request row.
   * When `idempotencyKey` matches a SUCCEEDED SEND, return that row with deduplicated=true.
   * When it matches an active PENDING SEND, implementations should surface a conflict
   * (throw) so the adapter does not issue a second SMSC send.
   */
  saveRequest(record: ProviderRequestRecord): Promise<SaveRequestResult>;

  updateRequest(
    id: string,
    patch: Partial<
      Pick<
        ProviderRequestRecord,
        | 'status'
        | 'providerMessageId'
        | 'httpStatus'
        | 'errorCode'
        | 'errorMessage'
        | 'responsePayload'
        | 'normalizedResult'
        | 'finishedAt'
      >
    >,
  ): Promise<void>;

  findSucceededSendByIdempotencyKey(input: {
    providerCode: string;
    tenantId: string;
    idempotencyKey: string;
  }): Promise<ProviderRequestRecord | null>;

  /** Latest SEND row for the key (any status) — used for in-flight / retry decisions. */
  findLatestSendByIdempotencyKey(input: {
    providerCode: string;
    tenantId: string;
    idempotencyKey: string;
  }): Promise<ProviderRequestRecord | null>;

  saveCallback(record: ProviderCallbackRecord): Promise<SaveCallbackResult>;
}

type InMemoryRequest = ProviderRequestRecord & { _seq: number };

/**
 * Thrown by persistence when a SEND with the same idempotency key is already PENDING.
 * Adapter maps this to ProviderError(kind: 'conflict').
 */
export class ProviderIdempotencyConflictError extends Error {
  readonly idempotencyKey: string;

  constructor(idempotencyKey: string) {
    super(`SEND already in flight for idempotencyKey=${idempotencyKey}`);
    this.name = 'ProviderIdempotencyConflictError';
    this.idempotencyKey = idempotencyKey;
  }
}

/** In-memory persistence for unit tests / dry runs. */
export class InMemoryProviderPersistence implements ProviderPersistencePort {
  readonly requests = new Map<string, InMemoryRequest>();
  readonly callbacks = new Map<string, ProviderCallbackRecord>();
  private seq = 0;

  async saveRequest(record: ProviderRequestRecord): Promise<SaveRequestResult> {
    if (record.idempotencyKey && record.kind === 'SEND') {
      const existing = await this.findLatestSendByIdempotencyKey({
        providerCode: record.providerCode,
        tenantId: record.tenantId,
        idempotencyKey: record.idempotencyKey,
      });
      if (existing?.status === 'SUCCEEDED' && existing.id) {
        return { id: existing.id, deduplicated: true };
      }
      if (existing?.status === 'PENDING') {
        throw new ProviderIdempotencyConflictError(record.idempotencyKey);
      }
    }
    const id = record.id ?? `req_${++this.seq}`;
    this.requests.set(id, { ...record, id, _seq: ++this.seq });
    return { id, deduplicated: false };
  }

  async updateRequest(
    id: string,
    patch: Partial<ProviderRequestRecord>,
  ): Promise<void> {
    const current = this.requests.get(id);
    if (!current) {
      return;
    }
    this.requests.set(id, { ...current, ...patch, id });
  }

  async findSucceededSendByIdempotencyKey(input: {
    providerCode: string;
    tenantId: string;
    idempotencyKey: string;
  }): Promise<ProviderRequestRecord | null> {
    const latest = await this.findLatestSendByIdempotencyKey(input);
    return latest?.status === 'SUCCEEDED' ? latest : null;
  }

  async findLatestSendByIdempotencyKey(input: {
    providerCode: string;
    tenantId: string;
    idempotencyKey: string;
  }): Promise<ProviderRequestRecord | null> {
    let best: InMemoryRequest | null = null;
    for (const row of this.requests.values()) {
      if (
        row.providerCode === input.providerCode &&
        row.tenantId === input.tenantId &&
        row.idempotencyKey === input.idempotencyKey &&
        row.kind === 'SEND'
      ) {
        if (!best || row._seq >= best._seq) {
          best = row;
        }
      }
    }
    return best;
  }

  async saveCallback(record: ProviderCallbackRecord): Promise<SaveCallbackResult> {
    if (record.dedupeKey) {
      for (const row of this.callbacks.values()) {
        if (row.dedupeKey === record.dedupeKey && row.providerCode === record.providerCode) {
          return { id: row.id!, deduplicated: true };
        }
      }
    }
    const id = record.id ?? `cb_${++this.seq}`;
    this.callbacks.set(id, { ...record, id });
    return { id, deduplicated: false };
  }
}

export type { ProviderCheckType };

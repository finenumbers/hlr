import type { PrismaClient } from '@finenumbers/db';
import { Prisma } from '@finenumbers/db';
import type {
  ProviderCallbackRecord,
  ProviderPersistencePort,
  ProviderRequestRecord,
  SaveCallbackResult,
  SaveRequestResult,
} from '@finenumbers/provider-core';
import { ProviderIdempotencyConflictError } from '@finenumbers/provider-core';

/**
 * Prisma-backed persistence hooks for the SMSC adapter.
 *
 * Stores three artefacts separately on each I/O row and enforces SEND/callback
 * dedupe via dedicated columns + partial unique indexes.
 */

export class PrismaProviderPersistence implements ProviderPersistencePort {
  constructor(private readonly prisma: PrismaClient) {}

  async saveRequest(record: ProviderRequestRecord): Promise<SaveRequestResult> {
    if (record.idempotencyKey && record.kind === 'SEND') {
      if (!record.tenantId) {
        throw new Error('SEND provider requests require tenantId');
      }
      const latest = await this.findLatestSendByIdempotencyKey({
        providerCode: record.providerCode,
        tenantId: record.tenantId,
        idempotencyKey: record.idempotencyKey,
      });
      if (latest?.status === 'SUCCEEDED' && latest.id) {
        return { id: latest.id, deduplicated: true };
      }
      if (latest?.status === 'PENDING') {
        throw new ProviderIdempotencyConflictError(record.idempotencyKey);
      }
    }

    try {
      const created = await this.prisma.providerRequest.create({
        data: {
          tenantId: record.tenantId ?? null,
          jobItemId: record.jobItemId ?? null,
          providerCode: record.providerCode,
          kind: record.kind,
          status: record.status,
          providerMessageId: record.providerMessageId ?? null,
          httpStatus: record.httpStatus ?? null,
          errorCode: record.errorCode ?? null,
          errorMessage: record.errorMessage ?? null,
          requestPayload: toJson(record.requestPayload),
          responsePayload:
            record.responsePayload === undefined ? undefined : toJson(record.responsePayload),
          normalizedResult:
            record.normalizedResult === undefined ? undefined : toJson(record.normalizedResult),
          idempotencyKey: record.idempotencyKey ?? null,
          startedAt: record.startedAt ?? null,
          finishedAt: record.finishedAt ?? null,
        },
        select: { id: true },
      });
      return { id: created.id, deduplicated: false };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        record.idempotencyKey
      ) {
        if (!record.tenantId) {
          throw new ProviderIdempotencyConflictError(record.idempotencyKey);
        }
        const latest = await this.findLatestSendByIdempotencyKey({
          providerCode: record.providerCode,
          tenantId: record.tenantId,
          idempotencyKey: record.idempotencyKey,
        });
        if (latest?.status === 'SUCCEEDED' && latest.id) {
          return { id: latest.id, deduplicated: true };
        }
        throw new ProviderIdempotencyConflictError(record.idempotencyKey);
      }
      throw error;
    }
  }

  async updateRequest(
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
  ): Promise<void> {
    await this.prisma.providerRequest.update({
      where: { id },
      data: {
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.providerMessageId !== undefined
          ? { providerMessageId: patch.providerMessageId }
          : {}),
        ...(patch.httpStatus !== undefined ? { httpStatus: patch.httpStatus } : {}),
        ...(patch.errorCode !== undefined ? { errorCode: patch.errorCode } : {}),
        ...(patch.errorMessage !== undefined ? { errorMessage: patch.errorMessage } : {}),
        ...(patch.responsePayload !== undefined
          ? { responsePayload: toJson(patch.responsePayload) }
          : {}),
        ...(patch.normalizedResult !== undefined
          ? { normalizedResult: toJson(patch.normalizedResult) }
          : {}),
        ...(patch.finishedAt !== undefined ? { finishedAt: patch.finishedAt } : {}),
      },
    });
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
    const row = await this.prisma.providerRequest.findFirst({
      where: {
        providerCode: input.providerCode,
        tenantId: input.tenantId,
        kind: 'SEND',
        idempotencyKey: input.idempotencyKey,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!row) {
      return null;
    }

    return mapRequestRow(row, input.idempotencyKey);
  }

  async saveCallback(record: ProviderCallbackRecord): Promise<SaveCallbackResult> {
    if (record.dedupeKey) {
      const existing = await this.prisma.providerCallback.findFirst({
        where: {
          providerCode: record.providerCode,
          dedupeKey: record.dedupeKey,
        },
        select: { id: true },
      });
      if (existing) {
        return { id: existing.id, deduplicated: true };
      }
    }

    try {
      const created = await this.prisma.providerCallback.create({
        data: {
          tenantId: record.tenantId ?? null,
          jobItemId: record.jobItemId ?? null,
          providerCode: record.providerCode,
          providerMessageId: record.providerMessageId ?? null,
          rawPayload: toJson({
            _meta: {
              dedupeKey: record.dedupeKey ?? null,
            },
            body: record.rawPayload,
          }),
          normalizedResult:
            record.normalizedResult === undefined || record.normalizedResult === null
              ? undefined
              : toJson(record.normalizedResult),
          dedupeKey: record.dedupeKey ?? null,
          signatureValid: record.signatureValid ?? null,
          processError: record.processError ?? null,
          processedAt: record.processedAt ?? null,
        },
        select: { id: true },
      });
      return { id: created.id, deduplicated: false };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        record.dedupeKey
      ) {
        const existing = await this.prisma.providerCallback.findFirst({
          where: {
            providerCode: record.providerCode,
            dedupeKey: record.dedupeKey,
          },
          select: { id: true },
        });
        if (existing) {
          return { id: existing.id, deduplicated: true };
        }
      }
      throw error;
    }
  }
}

function mapRequestRow(
  row: {
    id: string;
    tenantId: string | null;
    jobItemId: string | null;
    providerCode: string;
    kind: ProviderRequestRecord['kind'];
    status: ProviderRequestRecord['status'];
    providerMessageId: string | null;
    httpStatus: number | null;
    errorCode: string | null;
    errorMessage: string | null;
    requestPayload: unknown;
    responsePayload: unknown;
    normalizedResult: unknown;
    idempotencyKey: string | null;
    startedAt: Date | null;
    finishedAt: Date | null;
  },
  idempotencyKey: string,
): ProviderRequestRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    jobItemId: row.jobItemId,
    providerCode: row.providerCode,
    kind: row.kind,
    status: row.status,
    providerMessageId: row.providerMessageId,
    httpStatus: row.httpStatus,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    requestPayload: row.requestPayload,
    responsePayload: row.responsePayload,
    normalizedResult: (row.normalizedResult as ProviderRequestRecord['normalizedResult']) ?? null,
    idempotencyKey: row.idempotencyKey ?? idempotencyKey,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

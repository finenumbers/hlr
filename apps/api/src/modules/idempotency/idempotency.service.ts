import { createHash } from 'node:crypto';

import {
  ConflictException,
  Injectable,
} from '@nestjs/common';
import type { Prisma } from '@finenumbers/db';

import { ErrorCodes } from '../../common/errors/error-codes';
import { PrismaService } from '../../common/prisma/prisma.service';

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

/** Placeholder responseCode while a create is in-flight. */
const IN_FLIGHT_CODE = 0;

export type IdempotencyReplay = {
  responseCode: number;
  responseBody: unknown;
};

@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  hashRequest(input: {
    method: string;
    path: string;
    body: unknown;
  }): string {
    const canonical = JSON.stringify({
      method: input.method.toUpperCase(),
      path: input.path,
      body: input.body ?? null,
    });
    return createHash('sha256').update(canonical, 'utf8').digest('hex');
  }

  /**
   * Atomically claim the idempotency key (or replay a completed response).
   * Claim prevents two concurrent creates from both "proceeding" without coordination;
   * Job.unique(tenantId, idempotencyKey) remains the hard guarantee against a second job.
   */
  async beginOrReplay(input: {
    tenantId: string;
    key: string;
    requestHash: string;
  }): Promise<{ kind: 'proceed' } | { kind: 'replay'; replay: IdempotencyReplay }> {
    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: {
        tenantId_key: { tenantId: input.tenantId, key: input.key },
      },
    });

    if (existing) {
      return this.resolveExisting(existing, input.requestHash);
    }

    // Soft claim: insert in-flight placeholder. Unique violation → another worker claimed first.
    try {
      await this.prisma.idempotencyRecord.create({
        data: {
          tenantId: input.tenantId,
          key: input.key,
          requestHash: input.requestHash,
          responseCode: IN_FLIGHT_CODE,
          responseBody: { status: 'in_flight' },
          expiresAt: new Date(Date.now() + DEFAULT_TTL_MS),
        },
      });
      return { kind: 'proceed' };
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      const raced = await this.prisma.idempotencyRecord.findUnique({
        where: {
          tenantId_key: { tenantId: input.tenantId, key: input.key },
        },
      });
      if (!raced) {
        // Extremely rare: claimed then expired/deleted — allow proceed; job layer dedupes.
        return { kind: 'proceed' };
      }
      return this.resolveExisting(raced, input.requestHash);
    }
  }

  async commit(input: {
    tenantId: string;
    key: string;
    requestHash: string;
    responseCode: number;
    responseBody: unknown;
    ttlMs?: number;
  }): Promise<void> {
    const expiresAt = new Date(Date.now() + (input.ttlMs ?? DEFAULT_TTL_MS));
    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: {
        tenantId_key: { tenantId: input.tenantId, key: input.key },
      },
    });

    if (!existing) {
      try {
        await this.prisma.idempotencyRecord.create({
          data: {
            tenantId: input.tenantId,
            key: input.key,
            requestHash: input.requestHash,
            responseCode: input.responseCode,
            responseBody: input.responseBody as Prisma.InputJsonValue,
            expiresAt,
          },
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          return;
        }
        throw error;
      }
      return;
    }

    if (existing.requestHash !== input.requestHash) {
      throw new ConflictException({
        errorCode: ErrorCodes.IDEMPOTENCY_KEY_REUSE,
        message:
          'Idempotency-Key was already used with a different request body',
      });
    }

    // Completed response already stored — keep first writer wins.
    if (existing.responseCode !== IN_FLIGHT_CODE) {
      return;
    }

    await this.prisma.idempotencyRecord.update({
      where: { id: existing.id },
      data: {
        responseCode: input.responseCode,
        responseBody: input.responseBody as Prisma.InputJsonValue,
        expiresAt,
      },
    });
  }

  private resolveExisting(
    existing: {
      id: string;
      requestHash: string;
      responseCode: number;
      responseBody: unknown;
      expiresAt: Date;
    },
    requestHash: string,
  ): { kind: 'proceed' } | { kind: 'replay'; replay: IdempotencyReplay } {
    if (existing.expiresAt.getTime() <= Date.now()) {
      // Expired — caller may proceed; job-layer unique key still blocks a second job.
      void this.prisma.idempotencyRecord.delete({ where: { id: existing.id } }).catch(() => undefined);
      return { kind: 'proceed' };
    }

    if (existing.requestHash !== requestHash) {
      throw new ConflictException({
        errorCode: ErrorCodes.IDEMPOTENCY_KEY_REUSE,
        message:
          'Idempotency-Key was already used with a different request body',
      });
    }

    if (existing.responseCode === IN_FLIGHT_CODE) {
      // Another request holds the claim. Still proceed to job create — unique constraint
      // returns the same job; HTTP response will be filled by the first committer.
      return { kind: 'proceed' };
    }

    return {
      kind: 'replay',
      replay: {
        responseCode: existing.responseCode,
        responseBody: existing.responseBody,
      },
    };
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  );
}

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@finenumbers/db';

import { ErrorCodes } from '../../common/errors/error-codes';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { UpdatePlatformSettingsDto } from './dto/update-platform-settings.dto';

const SETTINGS_ID = 'default';

/** Keys that must never appear in PlatformSettings.extras (secrets live in env). */
const FORBIDDEN_EXTRAS_KEYS = [
  'smsc_login',
  'smsc_password',
  'smsc_api_key',
  'smscpassword',
  'smscapikey',
  'password',
  'api_key',
  'apikey',
  'secret',
  'token',
];

export type PlatformSettingsDto = {
  id: string;
  currency: string;
  defaultRateLimitRpm: number;
  maxCsvRows: number;
  maxCsvBytes: number;
  maxBatchPhones: number;
  checkTimeoutSec: number;
  pollIntervalSec: number;
  webhookMaxAttempts: number;
  webhookTimeoutMs: number;
  retentionDays: number;
  smscBaseUrl: string | null;
  extras: Record<string, unknown> | null;
  updatedAt: string;
};

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(): Promise<PlatformSettingsDto> {
    const row = await this.prisma.platformSettings.findUnique({
      where: { id: SETTINGS_ID },
    });
    if (!row) {
      throw new NotFoundException({
        errorCode: ErrorCodes.NOT_FOUND,
        message: 'Platform settings not found',
      });
    }
    return mapSettings(row);
  }

  async update(
    dto: UpdatePlatformSettingsDto,
    actorUserId: string,
    meta?: { ip?: string | null; userAgent?: string | null },
  ): Promise<PlatformSettingsDto> {
    if (dto.extras !== undefined && dto.extras !== null) {
      assertNoSecretExtras(dto.extras);
    }

    const before = await this.get();

    const data: Prisma.PlatformSettingsUpdateInput = {};
    if (dto.currency !== undefined) data.currency = dto.currency;
    if (dto.defaultRateLimitRpm !== undefined) data.defaultRateLimitRpm = dto.defaultRateLimitRpm;
    if (dto.maxCsvRows !== undefined) data.maxCsvRows = dto.maxCsvRows;
    if (dto.maxCsvBytes !== undefined) data.maxCsvBytes = dto.maxCsvBytes;
    if (dto.maxBatchPhones !== undefined) data.maxBatchPhones = dto.maxBatchPhones;
    if (dto.checkTimeoutSec !== undefined) data.checkTimeoutSec = dto.checkTimeoutSec;
    if (dto.pollIntervalSec !== undefined) data.pollIntervalSec = dto.pollIntervalSec;
    if (dto.webhookMaxAttempts !== undefined) data.webhookMaxAttempts = dto.webhookMaxAttempts;
    if (dto.webhookTimeoutMs !== undefined) data.webhookTimeoutMs = dto.webhookTimeoutMs;
    if (dto.retentionDays !== undefined) data.retentionDays = dto.retentionDays;
    if (dto.smscBaseUrl !== undefined) data.smscBaseUrl = dto.smscBaseUrl;
    if (dto.extras !== undefined) {
      data.extras =
        dto.extras === null ? Prisma.DbNull : (dto.extras as Prisma.InputJsonValue);
    }

    if (Object.keys(data).length === 0) {
      throw new BadRequestException({
        errorCode: ErrorCodes.VALIDATION_FAILED,
        message: 'No settings fields to update',
      });
    }

    const row = await this.prisma.platformSettings.update({
      where: { id: SETTINGS_ID },
      data,
    });
    const after = mapSettings(row);

    await this.audit.write({
      actorType: 'USER',
      actorUserId,
      action: 'platform.settings.update',
      targetType: 'PlatformSettings',
      targetId: SETTINGS_ID,
      ip: meta?.ip ?? null,
      userAgent: meta?.userAgent ?? null,
      metadata: {
        before: pickComparable(before),
        after: pickComparable(after),
      } as Prisma.InputJsonValue,
    });

    return after;
  }
}

function mapSettings(row: {
  id: string;
  currency: string;
  defaultRateLimitRpm: number;
  maxCsvRows: number;
  maxCsvBytes: number;
  maxBatchPhones: number;
  checkTimeoutSec: number;
  pollIntervalSec: number;
  webhookMaxAttempts: number;
  webhookTimeoutMs: number;
  retentionDays: number;
  smscBaseUrl: string | null;
  extras: unknown;
  updatedAt: Date;
}): PlatformSettingsDto {
  return {
    id: row.id,
    currency: row.currency,
    defaultRateLimitRpm: row.defaultRateLimitRpm,
    maxCsvRows: row.maxCsvRows,
    maxCsvBytes: row.maxCsvBytes,
    maxBatchPhones: row.maxBatchPhones,
    checkTimeoutSec: row.checkTimeoutSec,
    pollIntervalSec: row.pollIntervalSec,
    webhookMaxAttempts: row.webhookMaxAttempts,
    webhookTimeoutMs: row.webhookTimeoutMs,
    retentionDays: row.retentionDays,
    smscBaseUrl: row.smscBaseUrl,
    extras:
      row.extras && typeof row.extras === 'object' && !Array.isArray(row.extras)
        ? (row.extras as Record<string, unknown>)
        : null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function pickComparable(s: PlatformSettingsDto): Record<string, unknown> {
  const { updatedAt: _u, id: _id, ...rest } = s;
  return rest;
}

function assertNoSecretExtras(extras: Record<string, unknown>): void {
  for (const key of Object.keys(extras)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (FORBIDDEN_EXTRAS_KEYS.some((f) => normalized.includes(f.replace(/_/g, '')))) {
      throw new BadRequestException({
        errorCode: ErrorCodes.VALIDATION_FAILED,
        message: `PlatformSettings.extras must not contain secrets (blocked key: ${key}). Use SMSC_* env vars.`,
      });
    }
  }
}

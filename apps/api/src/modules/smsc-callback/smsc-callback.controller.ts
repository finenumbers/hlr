import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiExcludeController, ApiOperation, ApiTags } from '@nestjs/swagger';
import { isProviderError } from '@finenumbers/provider-core';
import type { Request } from 'express';

import { Public } from '../../common/decorators/public.decorator';
import { ErrorCodes } from '../../common/errors/error-codes';
import { AppLogger } from '../../common/logger/app-logger.service';
import { JobsService } from '../jobs/jobs.service';
import { ProviderSmscService } from '../provider-smsc/provider-smsc.service';

type CallbackResponse = {
  ok: true;
  applied: boolean;
  duplicate: boolean;
  deduplicated: boolean;
  providerMessageId: string | null;
  jobItemId: string | null;
  reason?: string;
};

/**
 * Inbound SMSC status callbacks.
 * Auth is signature-based (md5/sha1), not session/API key.
 */
@ApiTags('internal')
@ApiExcludeController()
@Controller('internal/smsc')
export class SmscCallbackController {
  constructor(
    private readonly providerSmsc: ProviderSmscService,
    private readonly jobs: JobsService,
    private readonly logger: AppLogger,
  ) {}

  @Public()
  @Post('callback')
  @HttpCode(200)
  @ApiOperation({ summary: 'SMSC status callback (POST)' })
  async postCallback(
    @Body() body: Record<string, unknown>,
    @Query() query: Record<string, unknown>,
    @Req() req: Request,
  ): Promise<CallbackResponse> {
    return this.handle(mergePayload(query, body), req);
  }

  @Public()
  @Get('callback')
  @HttpCode(200)
  @ApiOperation({ summary: 'SMSC status callback (GET)' })
  async getCallback(
    @Query() query: Record<string, unknown>,
    @Req() req: Request,
  ): Promise<CallbackResponse> {
    return this.handle(query, req);
  }

  private async handle(
    rawPayload: Record<string, unknown>,
    req: Request,
  ): Promise<CallbackResponse> {
    const signatures = extractSignatures(rawPayload, req);

    try {
      const result = await this.providerSmsc.handleProviderCallback({
        rawPayload,
        signatures,
        correlationId: req.headers['x-request-id']?.toString(),
      });

      try {
        const applied = await this.jobs.applyNormalizedCallback({
          providerMessageId: result.providerMessageId,
          normalized: result.normalized,
        });

        return {
          ok: true,
          applied: applied.applied,
          duplicate: applied.duplicate,
          deduplicated: result.deduplicated,
          providerMessageId: result.providerMessageId,
          jobItemId: applied.jobItem?.id ?? null,
        };
      } catch (error) {
        if (error instanceof NotFoundException) {
          // Unknown providerMessageId — acknowledge so SMSC does not retry forever.
          this.logger.warn(
            {
              message: 'smsc.callback.item_not_found',
              providerMessageId: result.providerMessageId,
            },
            'SmscCallback',
          );
          return {
            ok: true,
            applied: false,
            duplicate: false,
            deduplicated: result.deduplicated,
            providerMessageId: result.providerMessageId,
            jobItemId: null,
            reason: 'item_not_found',
          };
        }
        throw error;
      }
    } catch (error) {
      if (isProviderError(error) && error.kind === 'signature') {
        throw new UnauthorizedException({
          errorCode: ErrorCodes.UNAUTHORIZED,
          message: 'Invalid SMSC callback signature',
        });
      }
      if (isProviderError(error) && error.kind === 'auth') {
        throw new ForbiddenException({
          errorCode: ErrorCodes.FORBIDDEN,
          message: error.message,
        });
      }
      throw error;
    }
  }
}

function mergePayload(
  query: Record<string, unknown>,
  body: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return { ...query, ...(body && typeof body === 'object' ? body : {}) };
}

function extractSignatures(
  payload: Record<string, unknown>,
  req: Request,
): { md5?: string; sha1?: string; crc32?: string } {
  const headerMd5 =
    headerValue(req, 'x-smsc-md5') ?? headerValue(req, 'x-md5');
  const headerSha1 =
    headerValue(req, 'x-smsc-sha1') ?? headerValue(req, 'x-sha1');

  return {
    md5: asString(payload.md5) ?? headerMd5,
    sha1: asString(payload.sha1) ?? headerSha1,
    crc32: asString(payload.crc32),
  };
}

function headerValue(req: Request, name: string): string | undefined {
  const raw = req.headers[name];
  if (typeof raw === 'string' && raw.trim()) {
    return raw.trim();
  }
  if (Array.isArray(raw) && raw[0]?.trim()) {
    return raw[0].trim();
  }
  return undefined;
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

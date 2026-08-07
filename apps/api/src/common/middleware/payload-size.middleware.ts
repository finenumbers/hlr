import type { NextFunction, Request, Response } from 'express';

import { ErrorCodes } from '../errors/error-codes';
import {
  isCsvUploadPath,
  isSubmitWritePath,
  parseSizeToBytes,
} from '../rate-limit/rate-limit-zone';

/**
 * Reject oversized Content-Length before/around body parse (OWASP: payload size limits).
 * Express json limit must be set to the *max* (submit/csv); this enforces the smaller default
 * on non-submit routes.
 */
export function createPayloadSizeMiddleware(input: {
  bodyLimit: string;
  bodyLimitSubmit: string;
  bodyLimitCsv: string;
  requestTimeoutCsvMs?: number;
}) {
  const defaultBytes = parseSizeToBytes(input.bodyLimit);
  const submitBytes = parseSizeToBytes(input.bodyLimitSubmit);
  const csvBytes = parseSizeToBytes(input.bodyLimitCsv);
  const maxBytes = Math.max(defaultBytes, submitBytes, csvBytes);
  const csvTimeoutMs = input.requestTimeoutCsvMs ?? 0;

  return function payloadSizeMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const path = (req.originalUrl ?? req.url ?? '/').split('?')[0] || '/';
    const csv = isCsvUploadPath(req.method, path);
    const limit = csv
      ? csvBytes
      : isSubmitWritePath(req.method, path)
        ? submitBytes
        : defaultBytes;

    if (csv && csvTimeoutMs > 0) {
      req.setTimeout(csvTimeoutMs);
      res.setTimeout(csvTimeoutMs);
    }

    const header = req.headers['content-length'];
    if (header == null || header === '') {
      next();
      return;
    }

    const length = Number(header);
    if (!Number.isFinite(length) || length < 0) {
      next();
      return;
    }

    if (length > limit) {
      res.status(413).json({
        error: {
          code: ErrorCodes.PAYLOAD_TOO_LARGE,
          message: `Payload too large (max ${limit} bytes for this endpoint)`,
          requestId: (res.getHeader('x-request-id') as string | undefined) ?? undefined,
          details: {
            limitBytes: limit,
            maxParserBytes: maxBytes,
            contentLength: length,
          },
        },
      });
      return;
    }

    next();
  };
}

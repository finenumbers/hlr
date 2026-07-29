import type { NextFunction, Request, Response } from 'express';

import { ErrorCodes } from '../errors/error-codes';
import { isSubmitWritePath, parseSizeToBytes } from '../rate-limit/rate-limit-zone';

/**
 * Reject oversized Content-Length before/around body parse (OWASP: payload size limits).
 * Express json limit must be set to the *max* (submit); this enforces the smaller default
 * on non-submit routes.
 */
export function createPayloadSizeMiddleware(input: {
  bodyLimit: string;
  bodyLimitSubmit: string;
}) {
  const defaultBytes = parseSizeToBytes(input.bodyLimit);
  const submitBytes = parseSizeToBytes(input.bodyLimitSubmit);
  const maxBytes = Math.max(defaultBytes, submitBytes);

  return function payloadSizeMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const path = req.originalUrl ?? req.url ?? '/';
    const limit = isSubmitWritePath(req.method, path.split('?')[0] || '/')
      ? submitBytes
      : defaultBytes;

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

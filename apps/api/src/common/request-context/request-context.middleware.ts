import { randomUUID } from 'node:crypto';

import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { RequestContextService } from './request-context.service';

export const REQUEST_ID_HEADER = 'x-request-id';

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(private readonly requestContext: RequestContextService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header(REQUEST_ID_HEADER);
    const requestId = incoming && incoming.trim().length > 0 ? incoming.trim() : randomUUID();

    res.setHeader(REQUEST_ID_HEADER, requestId);

    this.requestContext.run({ requestId }, () => next());
  }
}

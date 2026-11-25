import { Injectable, Optional, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import {
  correlationHeaders,
  correlationId,
} from '../observability/correlation';
import { HotpathRedis } from './hotpath/hotpath-redis';

interface RequestWithId extends Request {
  id?: string;
}

/** Establishes correlation before guards execute. */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  constructor(@Optional() private readonly redis?: HotpathRedis) {}

  use(request: RequestWithId, response: Response, next: NextFunction): void {
    request.id ??= correlationId(request);
    correlationHeaders(response, request.id);
    if (this.redis) this.redis.withRequest(next);
    else next();
  }
}

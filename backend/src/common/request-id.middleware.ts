import { Injectable, Optional, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { generateUuidV7 } from '../utils';
import { HotpathRedis } from './hotpath/hotpath-redis';

interface RequestWithId extends Request {
  id?: string;
}

/** Establishes correlation before guards execute. */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  constructor(@Optional() private readonly redis?: HotpathRedis) {}

  use(request: RequestWithId, response: Response, next: NextFunction): void {
    const incoming = request.header('x-request-id')?.trim();
    request.id ??=
      incoming && incoming.length <= 128 ? incoming : generateUuidV7();
    response.setHeader('x-request-id', request.id);
    if (this.redis) this.redis.withRequest(next);
    else next();
  }
}

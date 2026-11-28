import {
  VERSION_NEUTRAL,
  VersioningType,
  type INestApplication,
} from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { Logger } from '@nestjs/common';
import { correlationHeaders, correlationId } from './observability/correlation';
import { InfrastructureException } from './exceptions';

/** Configuração pública compartilhada pelo bootstrap e pelos testes HTTP. */
export function configureApiVersioning(app: INestApplication): void {
  app.enableVersioning({
    type: VersioningType.URI,
    prefix: 'api/v',
    defaultVersion: [VERSION_NEUTRAL, '1'],
  });

  const origins = (process.env.FRONTEND_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (origins.includes('*')) {
    throw new InfrastructureException(
      'FRONTEND_ORIGIN must contain explicit origins, never wildcard',
    );
  }
  const logger = new Logger('HttpAccess');
  app.use(
    (
      request: Request & {
        id?: string;
        identity?: { id: string; organizationId: string | null };
        requestContext?: {
          userId: string | null;
          organizationId: string | null;
        };
      },
      response: Response,
      next: NextFunction,
    ) => {
      const started = performance.now();
      const id = (request.id ??= correlationId(request));
      correlationHeaders(response, id);
      const finish = () => {
        response.off('finish', finish);
        response.off('close', finish);
        if (response.statusCode < 400 && request.path.startsWith('/health/'))
          return;
        logger.log({
          event: 'http_request',
          correlationId: id,
          userId: request.identity?.id ?? request.requestContext?.userId,
          organizationId:
            request.identity?.organizationId ??
            request.requestContext?.organizationId,
          route: (request.route as { path?: string } | undefined)?.path,
          method: request.method,
          status: response.statusCode,
          result: response.writableFinished ? 'complete' : 'aborted',
          durationMs: Math.round((performance.now() - started) * 100) / 100,
        });
      };
      response.once('finish', finish);
      response.once('close', finish);
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('Referrer-Policy', 'no-referrer');
      response.setHeader('X-Frame-Options', 'DENY');
      response.setHeader(
        'Permissions-Policy',
        'camera=(), microphone=(), geolocation=()',
      );
      response.setHeader('Cache-Control', 'private, no-store');
      response.vary('Authorization');
      next();
    },
  );
  if (origins.length > 0) {
    app.enableCors({
      origin: origins,
      credentials: false,
      methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'authorization',
        'content-type',
        'idempotency-key',
        'if-modified-since',
        'if-none-match',
        'x-correlation-id',
        'x-request-id',
      ],
      exposedHeaders: [
        'content-disposition',
        'etag',
        'last-modified',
        'retry-after',
        'x-correlation-id',
        'x-document-sha256',
        'x-request-id',
      ],
      maxAge: 600,
    });
  }
}

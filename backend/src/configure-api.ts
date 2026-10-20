import {
  VERSION_NEUTRAL,
  VersioningType,
  type INestApplication,
} from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
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
        'x-request-id',
      ],
      exposedHeaders: [
        'content-disposition',
        'etag',
        'last-modified',
        'retry-after',
        'x-document-sha256',
        'x-request-id',
      ],
      maxAge: 600,
    });
  }

  app.use((_request: Request, response: Response, next: NextFunction) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=()',
    );
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
}

import type { NestExpressApplication } from '@nestjs/platform-express';

/** Keep raw webhook bytes and the embedded-brand-image limit on both parsers. */
export function configureHttpParsers(app: NestExpressApplication): void {
  app.useBodyParser('json', { limit: '1mb' });
  app.useBodyParser('urlencoded', { extended: true, limit: '1mb' });
}

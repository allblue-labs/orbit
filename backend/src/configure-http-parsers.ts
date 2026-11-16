import type { NestExpressApplication } from '@nestjs/platform-express';
import { text } from 'express';

/** Keep raw webhook bytes and the embedded-brand-image limit on both parsers. */
export function configureHttpParsers(app: NestExpressApplication): void {
  // SNS posts text/plain JSON. Parse only this route before the general parser;
  // reject oversized/chunked/compressed input without buffering the application's 1MB limit.
  app.use(
    '/api/v1/email/webhooks/ses-sns',
    text({ type: () => true, limit: '256kb', inflate: false }),
  );
  app.useBodyParser('json', { limit: '1mb' });
  app.useBodyParser('urlencoded', { extended: true, limit: '1mb' });
}

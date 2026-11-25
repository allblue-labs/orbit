import { SetMetadata } from '@nestjs/common';

export const IDEMPOTENT = Symbol('http-idempotency');
export type IdempotentResource = 'quote' | 'mobile-quote' | 'financial-entry';
export interface IdempotencyPolicy {
  route: string;
  resource: IdempotentResource;
}

export const Idempotent = (route: string, resource: IdempotentResource) =>
  SetMetadata(IDEMPOTENT, { route, resource } satisfies IdempotencyPolicy);

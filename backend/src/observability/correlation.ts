import type { Request, Response } from 'express';
import { generateUuidV7 } from '../utils';

const idPattern =
  /^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i;

export function safeCorrelationId(value: unknown): string | undefined {
  return typeof value === 'string' && idPattern.test(value) ? value : undefined;
}

export function correlationId(request: Request): string {
  return (
    safeCorrelationId(request.header('x-correlation-id')) ??
    safeCorrelationId(request.header('x-request-id')) ??
    generateUuidV7()
  );
}

export function correlationHeaders(response: Response, id: string): void {
  response.setHeader('x-correlation-id', id);
  response.setHeader('x-request-id', id);
}

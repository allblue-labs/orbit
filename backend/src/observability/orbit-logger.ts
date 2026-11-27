import type { LoggerService } from '@nestjs/common';
import type { RequestContext } from '../context';
import { safeCorrelationId } from './correlation';
import { processRole } from '../runtime/process-role';

const strings = new Set([
  'event',
  'stage',
  'role',
  'component',
  'queue',
  'group',
  'outcome',
  'result',
  'provider',
  'operation',
  'status',
  'classification',
  'errorCategory',
  'exceptionClass',
  'code',
  'errorCode',
  'failureCode',
  'method',
  'scope',
  'reason',
]);
const numbers = new Set([
  'durationMs',
  'statusCode',
  'count',
  'attempt',
  'maxAttempts',
  'retryInMs',
  'rssBytes',
  'eventLoopP95Ms',
  'ready',
  'pending',
  'running',
  'dead',
  'oldest_ready_ms',
  'average_ready_ms',
]);
const ids = new Set([
  'requestId',
  'correlationId',
  'organizationId',
  'userId',
  'jobId',
  'actorId',
  'technicalPrincipalId',
  'exportId',
  'deliveryId',
]);

function fields(data: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (ids.has(key)) {
      const id = safeCorrelationId(value);
      if (id) output[key] = id;
    } else if (
      strings.has(key) &&
      typeof value === 'string' &&
      /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/.test(value)
    ) {
      output[key] = value;
    } else if (
      (numbers.has(key) || key === 'status') &&
      typeof value === 'number' &&
      Number.isFinite(value)
    ) {
      output[key] = value;
    } else if (
      [
        'restrictedRole',
        'rolsuper',
        'rolbypassrls',
        'permanent',
        'retryable',
      ].includes(key) &&
      typeof value === 'boolean'
    ) {
      output[key] = value;
    } else if (
      key === 'route' &&
      typeof value === 'string' &&
      /^\/(?:[a-zA-Z0-9_:.-]+\/?){0,24}$/.test(value) &&
      value.length <= 220
    ) {
      output[key] = value;
    } else if (key === 'queues' && Array.isArray(value)) {
      output.queues = value
        .slice(0, 50)
        .filter((item) => item && typeof item === 'object')
        .map(fields);
    }
  }
  return output;
}

function record(message: unknown): Record<string, unknown> {
  if (
    typeof message === 'string' &&
    message.startsWith('{') &&
    message.length <= 16_384
  ) {
    try {
      return fields(JSON.parse(message) as Record<string, unknown>);
    } catch {
      return {};
    }
  }
  return message && typeof message === 'object' && !(message instanceof Error)
    ? fields(message as Record<string, unknown>)
    : {};
}

export class OrbitLogger implements LoggerService {
  context?: () => RequestContext | undefined;

  log(message: unknown, ...parameters: unknown[]) {
    this.write('info', message, parameters);
  }
  warn(message: unknown, ...parameters: unknown[]) {
    this.write('warn', message, parameters);
  }
  error(message: unknown, ...parameters: unknown[]) {
    this.write('error', message, parameters);
  }
  fatal(message: unknown, ...parameters: unknown[]) {
    this.write('fatal', message, parameters);
  }
  debug(message: unknown, ...parameters: unknown[]) {
    if (process.env.NODE_ENV !== 'production')
      this.write('debug', message, parameters);
  }
  verbose(message: unknown, ...parameters: unknown[]) {
    this.debug(message, ...parameters);
  }

  private write(level: string, message: unknown, parameters: unknown[]) {
    const data = record(message);
    const context = this.context?.();
    const component = parameters.at(-1);
    const output = {
      event: 'application_log',
      ...data,
      ...(typeof component === 'string' &&
      /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/.test(component)
        ? { component }
        : {}),
      timestamp: new Date().toISOString(),
      level,
      processRole: processRole(),
      correlationId:
        data.correlationId ??
        data.requestId ??
        safeCorrelationId(context?.requestId) ??
        null,
      organizationId:
        data.organizationId ??
        safeCorrelationId(context?.organizationId) ??
        null,
      userId:
        data.userId ??
        data.actorId ??
        safeCorrelationId(context?.userId) ??
        null,
      durationMs: data.durationMs ?? null,
    };
    const stream =
      level === 'error' || level === 'fatal' || level === 'warn'
        ? process.stderr
        : process.stdout;
    stream.write(JSON.stringify(output) + '\n');
  }
}

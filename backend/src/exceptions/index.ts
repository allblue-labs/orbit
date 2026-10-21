import { HttpException, HttpStatus } from '@nestjs/common';
import type { JSONObject } from '../contracts';

export interface ExceptionPayload {
  code: string;
  message: string;
  details?: JSONObject;
}

export class BaseException extends HttpException {
  readonly code: string;
  readonly details?: JSONObject;

  constructor(payload: ExceptionPayload, status: HttpStatus) {
    super(payload, status);
    this.code = payload.code;
    this.details = payload.details;
  }
}

export class BusinessException extends BaseException {
  constructor(message: string, code = 'BUSINESS_RULE_VIOLATION') {
    super({ code, message }, HttpStatus.UNPROCESSABLE_ENTITY);
  }
}

export class EntityNotFoundException extends BaseException {
  constructor(entity: string, identifier?: string) {
    super(
      {
        code: 'ENTITY_NOT_FOUND',
        message: identifier
          ? `${entity} with identifier ${identifier} was not found`
          : `${entity} was not found`,
      },
      HttpStatus.NOT_FOUND,
    );
  }
}

export class ConflictException extends BaseException {
  constructor(message: string, code = 'CONFLICT') {
    super({ code, message }, HttpStatus.CONFLICT);
  }
}

export class ValidationException extends BaseException {
  constructor(
    message: string,
    details?: JSONObject,
    code = 'VALIDATION_ERROR',
  ) {
    super({ code, message, details }, HttpStatus.BAD_REQUEST);
  }
}

export class ForbiddenException extends BaseException {
  constructor(message = 'Access denied', code = 'FORBIDDEN') {
    super({ code, message }, HttpStatus.FORBIDDEN);
  }
}

export class UnauthorizedException extends BaseException {
  constructor(message = 'Authentication is required', code = 'UNAUTHORIZED') {
    super({ code, message }, HttpStatus.UNAUTHORIZED);
  }
}

export class RateLimitException extends BaseException {
  constructor(retryAfterSeconds: number) {
    super(
      {
        code: 'RATE_LIMITED',
        message: 'Too many requests. Try again later.',
        details: { retryAfterSeconds },
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

/**
 * Um serviço de terceiro está fora — e isso não é defeito nosso.
 *
 * Distinto de `InfrastructureException` (500) de propósito: 503 diz "tente de
 * novo ou siga sem isto", e é a resposta certa para uma consulta de
 * conveniência. Um 500 faria o cliente tratar a queda do ViaCEP como falha do
 * Orbit, e o técnico em campo concluiria que não dá para cadastrar.
 */
export class ServiceUnavailableException extends BaseException {
  constructor(message: string, code = 'SERVICE_UNAVAILABLE') {
    super({ code, message }, HttpStatus.SERVICE_UNAVAILABLE);
  }
}

export class InfrastructureException extends BaseException {
  readonly internalCategory?: string;
  override readonly cause: unknown;

  constructor(
    message = 'Infrastructure operation failed',
    options?: { cause?: unknown; category?: string },
  ) {
    super(
      { code: 'INFRASTRUCTURE_ERROR', message },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
    this.cause = options?.cause;
    this.internalCategory = options?.category;
  }
}

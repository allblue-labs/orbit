import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { BaseException } from '../../exceptions';
import { publicErrorDefinition } from './public-error.catalog';
import {
  PUBLIC_ERROR_CODES,
  type PublicErrorCode,
  type PublicErrorReadModel,
  type PublicValidationCode,
  type PublicValidationIssueReadModel,
} from './public-error.read-models';

const knownCodes = new Set<string>(PUBLIC_ERROR_CODES);

/**
 * O status de um erro que não é `HttpException`, mas declara um.
 *
 * `body-parser` e o resto da pilha do Express usam `http-errors`: corpo grande
 * demais chega como um `Error` comum com `status: 413` e `expose: true`, e não
 * como exceção do Nest. Sem olhar para isso, o filtro achatava para 500 — e
 * "não foi possível concluir a solicitação" não diz a ninguém que mandou 2 MB
 * onde cabe 1.
 *
 * `expose === true` é a marca do que a biblioteca considera seguro mostrar ao
 * cliente, e é o que limita esta leitura: um status qualquer pendurado num erro
 * interno continua virando 500.
 */
export function exposedClientStatus(exception: unknown): number | null {
  if (typeof exception !== 'object' || exception === null) return null;
  const candidato = exception as {
    status?: unknown;
    statusCode?: unknown;
    expose?: unknown;
  };
  if (candidato.expose !== true) return null;

  const status =
    typeof candidato.status === 'number'
      ? candidato.status
      : typeof candidato.statusCode === 'number'
        ? candidato.statusCode
        : null;

  return status !== null && status >= 400 && status < 500 ? status : null;
}

/** Converte falhas internas para o único contrato público da API v1. */
export class PublicErrorMapper {
  map(exception: unknown): PublicErrorReadModel {
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : (exposedClientStatus(exception) ?? HttpStatus.INTERNAL_SERVER_ERROR);

    if (status >= 500) {
      return this.fromCode(
        status === Number(HttpStatus.SERVICE_UNAVAILABLE)
          ? 'SERVICE_UNAVAILABLE'
          : 'INTERNAL_SERVER_ERROR',
        status,
      );
    }

    if (
      exception instanceof BaseException &&
      exception.code !== 'VALIDATION_ERROR' &&
      knownCodes.has(exception.code)
    ) {
      return this.fromCode(
        exception.code as PublicErrorCode,
        status,
        exception,
      );
    }

    if (this.isValidationException(exception, status)) {
      return this.validation(exception, status);
    }

    return this.fromCode(this.codeForStatus(status), status, exception);
  }

  private isValidationException(exception: unknown, status: number): boolean {
    if (exception instanceof BaseException) {
      return exception.code === 'VALIDATION_ERROR';
    }
    return exception instanceof BadRequestException || status === 400;
  }

  private validation(exception: unknown, status: number): PublicErrorReadModel {
    const definition = publicErrorDefinition('VALIDATION_ERROR');
    const details = this.validationMessages(exception).map((message) =>
      this.validationIssue(message),
    );
    return {
      ...definition,
      status,
      ...(details.length > 0 ? { details } : {}),
    };
  }

  private validationMessages(exception: unknown): string[] {
    if (exception instanceof BaseException) return [];
    if (!(exception instanceof HttpException)) return [];
    const response = exception.getResponse();
    if (typeof response !== 'object' || response === null) return [];
    const message = 'message' in response ? response.message : undefined;
    if (typeof message === 'string') return [message];
    return Array.isArray(message)
      ? message.filter((item): item is string => typeof item === 'string')
      : [];
  }

  private validationIssue(message: string): PublicValidationIssueReadModel {
    const field = this.fieldPath(message);
    const code = this.validationCode(message);
    return { field, code, message: this.validationMessage(field, code) };
  }

  private fieldPath(message: string): string {
    const candidate = message
      .trim()
      .match(/^(?:property )?([A-Za-z][\w.[\]]*)/)?.[1];
    return candidate &&
      !['must', 'should', 'invalid'].includes(candidate.toLowerCase())
      ? candidate
      : '_request';
  }

  private validationCode(message: string): PublicValidationCode {
    const value = message.toLowerCase();
    if (value.includes('should not exist')) return 'UNKNOWN_FIELD';
    if (value.includes('must not be empty') || value.includes('is required'))
      return 'REQUIRED';
    if (
      value.includes('must be an email') ||
      value.includes('must be a uuid') ||
      value.includes('valid cpf') ||
      value.includes('valid cnpj')
    )
      return 'INVALID_FORMAT';
    if (
      value.includes('must be a string') ||
      value.includes('must be a number') ||
      value.includes('must be an integer') ||
      value.includes('must be a boolean') ||
      value.includes('must be an array')
    )
      return 'INVALID_TYPE';
    if (value.includes('longer than') || value.includes('minimum length'))
      return 'MIN_LENGTH';
    if (value.includes('shorter than') || value.includes('maximum length'))
      return 'MAX_LENGTH';
    if (
      value.includes('not be less than') ||
      value.includes('not be greater than')
    )
      return 'OUT_OF_RANGE';
    return 'INVALID_VALUE';
  }

  private validationMessage(field: string, code: PublicValidationCode): string {
    if (field === 'email' && code === 'INVALID_FORMAT')
      return 'Informe um e-mail válido.';
    if (field.toLowerCase().includes('document') && code === 'INVALID_FORMAT') {
      return 'Informe um CPF ou CNPJ válido.';
    }
    return {
      REQUIRED: 'Este campo é obrigatório.',
      UNKNOWN_FIELD: 'Este campo não é aceito.',
      INVALID_FORMAT: 'Informe um valor no formato esperado.',
      INVALID_TYPE: 'Informe um valor do tipo esperado.',
      INVALID_VALUE: 'Informe um valor válido.',
      MIN_LENGTH: 'O valor informado é muito curto.',
      MAX_LENGTH: 'O valor informado é muito longo.',
      OUT_OF_RANGE: 'O valor informado está fora do intervalo permitido.',
    }[code];
  }

  private fromCode(
    code: PublicErrorCode,
    status: number,
    exception?: unknown,
  ): PublicErrorReadModel {
    const definition = publicErrorDefinition(code);
    const retryAfterSeconds =
      code === 'RATE_LIMITED' && exception instanceof BaseException
        ? exception.details?.retryAfterSeconds
        : undefined;
    return {
      ...definition,
      status,
      ...(typeof retryAfterSeconds === 'number'
        ? { details: { retryAfterSeconds } }
        : {}),
    };
  }

  private codeForStatus(status: number): PublicErrorCode {
    switch (status) {
      case 401:
        return 'UNAUTHORIZED';
      case 403:
        return 'FORBIDDEN';
      case 404:
        return 'ENTITY_NOT_FOUND';
      case 409:
        return 'CONFLICT';
      case 413:
        return 'PAYLOAD_TOO_LARGE';
      case 422:
        return 'BUSINESS_RULE_VIOLATION';
      case 429:
        return 'RATE_LIMITED';
      default:
        return status >= 400 && status < 500
          ? 'REQUEST_REJECTED'
          : 'INTERNAL_SERVER_ERROR';
    }
  }
}

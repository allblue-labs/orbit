import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ExceptionFilter,
} from '@nestjs/common';
import { captureOrbitError } from '../observability/sentry';
import type { Request, Response } from 'express';
import { classifyInternalError } from '../errors';
import { exposedClientStatus, PublicErrorMapper } from './public-errors';

interface RequestWithId extends Request {
  id?: string;
  identity?: {
    id?: string;
    organizationId?: string | null;
  };
}

@Catch()
export class FoundationExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(FoundationExceptionFilter.name);
  private readonly publicErrors = new PublicErrorMapper();

  /**
   * Lido a cada uso, não na construção.
   *
   * O filtro é instanciado uma vez por aplicação, e em processo de teste isso
   * acontece antes de a variável estar no lugar. Ler aqui custa um acesso a
   * `process.env` por recusa — e recusa não é caminho quente.
   */
  private get logsClientErrors(): boolean {
    return (process.env.LOG_CLIENT_ERRORS ?? '').trim() === 'true';
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<RequestWithId>();
    /* O mesmo cálculo do mapeador: se os dois divergirem, a resposta sai com um
       status no cabeçalho e outro no corpo. */
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : (exposedClientStatus(exception) ?? HttpStatus.INTERNAL_SERVER_ERROR);
    const payload = this.publicErrors.map(exception);
    if (
      payload.code === 'RATE_LIMITED' &&
      payload.details &&
      'retryAfterSeconds' in payload.details
    ) {
      response.setHeader(
        'Retry-After',
        String(payload.details.retryAfterSeconds),
      );
    }
    if (status >= 500) {
      const classified = classifyInternalError(exception);
      captureOrbitError(exception, {
        requestId: request.id ?? '',
        organizationId: request.identity?.organizationId ?? null,
      });
      this.logger.error({
        stage: 'internal-error',
        status,
        method: request.method,
        route: (request.route as { path?: string } | undefined)?.path,
        requestId: request.id ?? null,
        actorId: request.identity?.id ?? null,
        organizationId: request.identity?.organizationId ?? null,
        errorCategory: classified.category,
        exceptionClass: classified.exceptionClass,
        errorCode: classified.code,
      });
    } else if (status >= 400 && this.logsClientErrors) {
      /**
       * Recusa de cliente, registrada sob demanda.
       *
       * Desligado por padrão: 4xx é conversa normal com o cliente e encheria o
       * log. Ligado, é o que permite explicar um 404 que não deveria existir —
       * a investigação da PR-26.6.1 dependeu exatamente disto, porque status
       * sem mensagem não distingue "não existe" de "não vejo".
       */
      this.logger.warn(
        JSON.stringify({
          stage: 'client-error',
          status,
          method: request.method,
          route: (request.route as { path?: string } | undefined)?.path,
          code: 'code' in payload ? payload.code : null,
          requestId: request.id ?? null,
        }),
      );
    }
    response.status(status).json({
      success: false,
      error: payload,
      requestId: request.id ?? 'unknown',
      timestamp: new Date().toISOString(),
    });
  }
}

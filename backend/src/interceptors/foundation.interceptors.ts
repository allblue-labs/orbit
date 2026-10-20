import {
  CallHandler,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  type NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { redactSensitivePath } from '../common/redact-sensitive-path';
import type { Request, Response } from 'express';
import { defer, type Observable, tap, map } from 'rxjs';
import type {
  IBaseResponse,
  IAuthenticatedUser,
  IRequestContext,
  UUID,
} from '../contracts';
import { RequestContext, RequestContextStorage } from '../context';
import { generateUuidV7 } from '../utils';

interface FoundationRequest extends Request {
  id?: string;
  user?: IAuthenticatedUser;
  requestContext?: IRequestContext;
  actorType?: IRequestContext['actorType'];
  portalIdentityId?: UUID;
  customerId?: UUID;
  organizationId?: UUID;
  businessUnitId?: UUID;
  businessUnitIds?: readonly UUID[];
}

@Injectable()
export class RequestIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<FoundationRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    const incoming = request.header('x-request-id')?.trim();
    request.id ??=
      incoming && incoming.length <= 128 ? incoming : generateUuidV7();
    response.setHeader('x-request-id', request.id);
    return next.handle();
  }
}

/**
 * Creates the immutable request context and propagates it through async calls.
 * Authentication may enrich the request before this interceptor executes.
 */
@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
  constructor(private readonly storage: RequestContextStorage) {}

  intercept(
    execution: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    const request = execution.switchToHttp().getRequest<FoundationRequest>();
    const context = new RequestContext({
      requestId: request.id ?? generateUuidV7(),
      actorType: request.actorType,
      userId: request.user?.id ?? null,
      portalIdentityId: request.portalIdentityId ?? null,
      organizationId: request.organizationId ?? null,
      customerId: request.customerId ?? null,
      businessUnitId: request.businessUnitId ?? null,
      businessUnitIds:
        request.businessUnitIds ??
        (request.businessUnitId ? [request.businessUnitId] : []),
      roles: request.user?.roles ?? [],
      permissions: request.user?.permissions ?? [],
      allowedSurfaces: request.user?.allowedSurfaces ?? [],
      isOrganizationOwner: request.user?.isOrganizationOwner ?? false,
      ip: request.ip ?? null,
      userAgent: request.header('user-agent') ?? null,
      locale: request.acceptsLanguages()[0] ?? 'pt-BR',
    });
    request.requestContext = context;
    return defer(() => this.storage.run(context, () => next.handle()));
  }
}

/** Logs request completion without serializing request bodies or credentials. */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<FoundationRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    const startedAt = performance.now();
    return next.handle().pipe(
      tap({
        next: () =>
          this.log(request, response.statusCode, performance.now() - startedAt),
        error: (error: unknown) =>
          this.log(
            request,
            error instanceof HttpException
              ? error.getStatus()
              : HttpStatus.INTERNAL_SERVER_ERROR,
            performance.now() - startedAt,
          ),
      }),
    );
  }

  private log(
    request: FoundationRequest,
    statusCode: number,
    durationMs: number,
  ): void {
    this.logger.log(
      JSON.stringify({
        requestId: request.id,
        method: request.method,
        path: redactSensitivePath(request.originalUrl),
        statusCode,
        durationMs: Number(durationMs.toFixed(2)),
      }),
    );
  }
}

/**
 * Wraps successful controller results in the global API envelope.
 *
 * **Exceto arquivo.** Uma rota que devolve `StreamableFile` já escolheu o
 * `Content-Type` e o `Content-Disposition` do corpo; embrulhar o stream num
 * envelope JSON produz a pior combinação possível — cabeçalhos dizendo
 * `application/pdf` e um corpo que é `{ "success": true, ... }`. O navegador
 * salva o arquivo, o arquivo não abre, e nada na resposta denuncia o motivo.
 */
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<
  T,
  IBaseResponse<T> | StreamableFile
> {
  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<IBaseResponse<T> | StreamableFile> {
    const request = context.switchToHttp().getRequest<FoundationRequest>();
    return next.handle().pipe(
      map((data) =>
        data instanceof StreamableFile
          ? data
          : {
              success: true,
              data,
              requestId: request.id ?? 'unknown',
              timestamp: new Date().toISOString(),
            },
      ),
    );
  }
}

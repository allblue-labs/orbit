import { requestClientIp } from '../common/trusted-client-origin';
import {
  CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable, map } from 'rxjs';
import type {
  IBaseResponse,
  IAuthenticatedUser,
  IRequestContext,
  UUID,
} from '../contracts';
import { RequestContext, RequestContextStorage } from '../context';
import { generateUuidV7 } from '../utils';
import type { VerifiedPlatformAuthority } from '../common/verified-platform-authority';

interface FoundationRequest extends Request {
  id?: string;
  user?: IAuthenticatedUser & { platformAuthority?: VerifiedPlatformAuthority };
  requestContext?: IRequestContext;
  actorType?: IRequestContext['actorType'];
  portalIdentityId?: UUID;
  customerId?: UUID;
  organizationId?: UUID;
  businessUnitId?: UUID;
  businessUnitIds?: readonly UUID[];
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
      platformAuthority: request.user?.platformAuthority,
      permissions: request.user?.permissions ?? [],
      allowedSurfaces: request.user?.allowedSurfaces ?? [],
      isOrganizationOwner: request.user?.isOrganizationOwner ?? false,
      ip: requestClientIp(request),
      userAgent: request.header('user-agent') ?? null,
      locale: request.acceptsLanguages()[0] ?? 'pt-BR',
    });
    request.requestContext = context;
    return new Observable((subscriber) =>
      this.storage.run(context, () => next.handle().subscribe(subscriber)),
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

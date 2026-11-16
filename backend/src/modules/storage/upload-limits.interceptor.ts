import {
  Injectable,
  type NestInterceptor,
  type ExecutionContext,
  type CallHandler,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { Observable } from 'rxjs';
import { RequestContextStorage } from '../../context';
import { ForbiddenException, ValidationException } from '../../exceptions';
import { UploadBudgetService, UPLOAD_LIMITS } from './upload-budget.service';
import {
  UPLOAD_RESERVATION,
  closeUploadRequest,
  type UploadRequest,
} from './upload-context';

/** Counts wire bytes without retaining chunks, before Multer or the raw reader starts. */
@Injectable()
export class UploadLimitsInterceptor implements NestInterceptor {
  private readonly logger = new Logger(UploadLimitsInterceptor.name);
  constructor(
    private readonly budgets: UploadBudgetService,
    private readonly contexts: RequestContextStorage,
  ) {}

  async intercept(
    execution: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const req = execution.switchToHttp().getRequest<UploadRequest>();
    const res = execution.switchToHttp().getResponse<Response>();
    try {
      const reservation = req[UPLOAD_RESERVATION];
      const context = reservation?.context ?? this.contexts.get();
      if (!context?.organizationId) throw new ForbiddenException();
      const multipart = req.is('multipart/form-data');
      const limit =
        (reservation?.sizeBytes ?? UPLOAD_LIMITS.maxBytes) +
        (multipart ? UPLOAD_LIMITS.overheadBytes : 0);
      const length = req.header('content-length');
      if (
        req.header('content-encoding') &&
        req.header('content-encoding') !== 'identity'
      )
        throw new ValidationException(
          'Não envie arquivos comprimidos no transporte.',
        );
      if (
        length &&
        (!/^\d+$/.test(length) ||
          Number(length) > limit ||
          (!multipart &&
            reservation &&
            Number(length) !== reservation.sizeBytes))
      )
        throw new ValidationException(
          'O arquivo excede o tamanho permitido ou difere da reserva.',
          undefined,
          'FILE_TOO_LARGE',
        );
      if (
        !multipart &&
        (!reservation || req.header('content-type') !== reservation.mimeType)
      )
        throw new ValidationException(
          'Formato de arquivo não permitido.',
          undefined,
          'FILE_INVALID',
        );
      const release = await this.contexts.run(context, () =>
        this.budgets.acquire(context.organizationId!, reservation?.id),
      );
      return new Observable((subscriber) => {
        let releasePromise: Promise<void> | undefined;
        const finish = () =>
          (releasePromise ??= this.contexts.run(context, release).catch(() => {
            this.logger.warn(
              'Upload admission release failed; its lease will expire.',
            );
          }));
        let received = 0;
        let failed = false;
        let ended = false;
        const stop = (status: number) => {
          if (failed) return;
          failed = true;
          req.unpipe();
          req.pause();
          closeUploadRequest(req, res);
          subscriber.error(
            new HttpException(
              status === 413
                ? 'O arquivo excede o tamanho permitido.'
                : 'O envio foi interrompido ou demorou demais. Tente novamente.',
              status,
            ),
          );
        };
        const total = setTimeout(() => stop(408), UPLOAD_LIMITS.bodyMs);
        const idle = () => stop(408);
        const onData = (chunk: Buffer | string) => {
          received += Buffer.isBuffer(chunk)
            ? chunk.length
            : Buffer.byteLength(chunk);
          if (received > limit) stop(413);
        };
        const onEnd = () => {
          ended = true;
          clearTimeout(total);
          req.setTimeout(0);
        };
        const onAbort = () => stop(400);
        req.setTimeout(UPLOAD_LIMITS.idleMs, idle);
        req.on('data', onData);
        req.once('end', onEnd);
        req.once('aborted', onAbort);
        req.once('error', onAbort);
        req.pause();
        // Subscribe in this same stack: the data listener must not consume bytes
        // while asynchronous guards/admission are still running ahead of Multer.
        const subscription = next.handle().subscribe({
          next: (value: unknown) => subscriber.next(value),
          error: (error: unknown) => {
            closeUploadRequest(req, res);
            void finish().then(() => subscriber.error(error));
          },
          complete: () => {
            void finish().then(() => subscriber.complete());
          },
        });
        if (req.aborted || req.destroyed) stop(400);
        return () => {
          subscription.unsubscribe();
          clearTimeout(total);
          req.setTimeout(0);
          req.removeListener('timeout', idle);
          req.removeListener('data', onData);
          req.removeListener('end', onEnd);
          req.removeListener('aborted', onAbort);
          req.removeListener('error', onAbort);
          if (!ended && !req.complete) {
            req.unpipe();
            req.pause();
          }
          void finish();
        };
      });
    } catch (error) {
      closeUploadRequest(req, res);
      throw error;
    }
  }
}

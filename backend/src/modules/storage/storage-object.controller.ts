import { requestClientIp } from '../../common/trusted-client-origin';
import { StorageUploadGuard } from './storage-upload.guard';
/** Signed upload gateway: buffers are bounded, validated and optimized before storage.
 * Only the development LOCAL provider serves GET here; R2 uses CDN/private signed GET.
 */
import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Put,
  UploadedFile,
  UseInterceptors,
  UseGuards,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { UUID } from '../../contracts';
import { RequestContext, RequestContextStorage } from '../../context';
import { FileObjectService } from './file-object.service';
import { verifyUploadGrant } from './upload-grant';
import { ValidationException } from '../../exceptions';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../../decorators';
import { ForbiddenException, InfrastructureException } from '../../exceptions';
import { STORAGE_CONFIG, type StorageConfig } from './storage.config';
import { STORAGE_PROVIDER, type StorageProvider } from './storage.types';
import { LocalFilesystemStorageProvider } from './providers/local-filesystem.storage';
import { SignedObjectQueryDto } from './dto/signed-object.dto';

@ApiExcludeController()
@Controller('storage/objects')
export class StorageObjectController {
  constructor(
    @Inject(STORAGE_PROVIDER) private readonly provider: StorageProvider,
    @Inject(STORAGE_CONFIG) private readonly config: StorageConfig,
    private readonly files: FileObjectService,
    private readonly contexts: RequestContextStorage,
  ) {}

  /**
   * `@Res()` sem `passthrough`, de propósito.
   *
   * O interceptor de resposta da plataforma embrulha todo retorno no envelope
   * `{ success, data, requestId }`. Um objeto binário embrulhado em JSON
   * chegaria corrompido — foi o que o E2E flagrou. Escrever direto na resposta
   * é o mesmo caminho que o download de anexo de operação já usa.
   */
  @Public()
  @Get()
  async download(
    @Query() query: SignedObjectQueryDto,
    @Res() response: Response,
  ): Promise<void> {
    const provider = this.local();

    const valid = provider.verify({
      bucket: query.bucket,
      objectKey: query.key,
      operation: query.operation,
      expiresAt: query.expires,
      signature: query.signature,
    });
    /** Assinatura inválida e expirada dão a mesma resposta, de propósito. */
    if (!valid) {
      throw new ForbiddenException(
        'Invalid or expired object signature',
        'STORAGE_SIGNATURE_INVALID',
      );
    }

    if (query.operation === 'upload') {
      throw new ForbiddenException(
        'Upload signatures are consumed by PUT, not GET',
      );
    }

    const body = await provider.get({
      bucket: query.bucket,
      objectKey: query.key,
    });

    response.setHeader('Content-Type', 'application/octet-stream');
    response.setHeader('Content-Length', String(body.length));
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'private, max-age=0, no-store');
    response.setHeader(
      'Content-Disposition',
      query.operation === 'preview'
        ? 'inline'
        : `attachment; filename*=UTF-8''${encodeURIComponent(query.filename ?? 'arquivo')}`,
    );
    /** O nome do bucket configurado não vaza no corpo nem nos cabeçalhos. */
    void this.config;
    response.send(body);
  }

  @Public()
  @Put()
  @UseGuards(StorageUploadGuard)
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 20_000_000, files: 1, fields: 0 },
      fileFilter: (_request, file, callback) => {
        const allowed = [
          'image/jpeg',
          'image/png',
          'image/webp',
          'image/heic',
          'application/pdf',
        ];
        callback(
          allowed.includes(file.mimetype)
            ? null
            : new ValidationException('Formato de arquivo não permitido.'),
          allowed.includes(file.mimetype),
        );
      },
    }),
  )
  async upload(
    @Query() query: SignedObjectQueryDto,
    @Req() request: Request,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<{ received: number }> {
    if (query.operation !== 'upload' || !verifyUploadGrant(this.config, query))
      throw new ForbiddenException(
        'Invalid or expired object signature',
        'STORAGE_SIGNATURE_INVALID',
      );
    // Keys are generated server-side as namespace/organization/id.ext.
    const organizationId = query.key.split('/')[1];
    if (!organizationId || !/^[0-9a-f-]{36}$/.test(organizationId))
      throw new ForbiddenException('Invalid upload scope');
    const body = file?.buffer ?? (await this.readBody(request));
    const mimeType =
      file?.mimetype ??
      request.header('content-type') ??
      'application/octet-stream';
    if (mimeType.startsWith('image/') && body.length > 10_000_000)
      throw new ValidationException(
        'A imagem deve ter até 10 MB.',
        undefined,
        'FILE_TOO_LARGE',
      );
    // The verified capability scopes this anonymous transport to exactly one
    // reserved row. RLS remains enabled; no platform-admin/service bypass.
    await this.contexts.run(
      new RequestContext({
        requestId: 'signed-upload',
        actorType: 'INTERNAL_USER',
        userId: null,
        organizationId: organizationId as UUID,
        businessUnitId: null,
        businessUnitIds: [],
        roles: [],
        permissions: [],
        ip: requestClientIp(request),
        userAgent: null,
        locale: 'pt-BR',
      }),
      () =>
        this.files.uploadReserved(
          organizationId,
          query.bucket,
          query.key,
          body,
          mimeType,
        ),
    );
    return { received: body.length };
  }

  private local(): LocalFilesystemStorageProvider {
    if (!(this.provider instanceof LocalFilesystemStorageProvider)) {
      throw new InfrastructureException(
        'Signed object delivery is handled by the storage provider',
      );
    }
    return this.provider;
  }

  private async readBody(request: Request): Promise<Buffer> {
    const limit = request.header('content-type')?.startsWith('image/')
      ? 10_000_000
      : 20_000_000;
    if (Number(request.header('content-length')) > limit)
      throw new ValidationException(
        'O arquivo excede o limite permitido.',
        undefined,
        'FILE_TOO_LARGE',
      );
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk as Uint8Array);
      size += buffer.length;
      if (size > limit)
        throw new ValidationException(
          'O arquivo excede o limite permitido.',
          undefined,
          'FILE_TOO_LARGE',
        );
      chunks.push(buffer);
    }
    return Buffer.concat(chunks, size);
  }
}

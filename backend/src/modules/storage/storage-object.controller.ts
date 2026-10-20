/**
 * Entrega de objeto do provider `LOCAL`.
 *
 * ## Por que esta rota é pública
 *
 * Ela **é** o object store do provider local — o equivalente ao endpoint do S3.
 * A autorização já aconteceu quando a URL foi assinada: o domínio verificou
 * RLS, capability e permissão antes de emitir. A assinatura carrega essa
 * decisão, com prazo curto e escopo de um único objeto.
 *
 * Exigir sessão aqui além disso quebraria o propósito da URL assinada — um
 * `<img>` ou uma aba nova não carregam cookie de outra origem — e não
 * acrescentaria segurança: quem tem a URL já passou pela autorização.
 *
 * Sem assinatura válida, não há resposta: nenhum caminho lê objeto por chave
 * crua.
 *
 * ## Nos demais providers
 *
 * Não é usada. A URL assinada aponta direto para o S3/MinIO, e o binário nunca
 * passa pela API.
 */
import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
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

  /**
   * Recebe o conteúdo de um upload assinado.
   *
   * É o par do `PUT` que o S3 receberia. O corpo chega cru — nenhum parser do
   * Nest o toca — e é gravado exatamente como veio: o hash calculado depois,
   * na confirmação, precisa ser o do byte a byte enviado.
   */
  @Public()
  @Put()
  @HttpCode(HttpStatus.OK)
  async upload(
    @Query() query: SignedObjectQueryDto,
    @Req() request: Request,
  ): Promise<{ received: number }> {
    const provider = this.local();

    if (query.operation !== 'upload') {
      throw new ForbiddenException(
        'This signature does not authorize an upload',
      );
    }
    if (
      !provider.verify({
        bucket: query.bucket,
        objectKey: query.key,
        operation: query.operation,
        expiresAt: query.expires,
        signature: query.signature,
      })
    ) {
      throw new ForbiddenException(
        'Invalid or expired object signature',
        'STORAGE_SIGNATURE_INVALID',
      );
    }

    const body = await this.readBody(request);
    await provider.put({
      bucket: query.bucket,
      objectKey: query.key,
      body,
      mimeType: request.header('content-type') ?? 'application/octet-stream',
    });

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

  private readBody(request: Request): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => resolve(Buffer.concat(chunks)));
      request.on('error', reject);
    });
  }
}

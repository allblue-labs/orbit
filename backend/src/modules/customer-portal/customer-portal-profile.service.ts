/**
 * Foto e assinatura do cliente.
 *
 * ## Onde ficam
 *
 * No storage, sob `customer-portal/<organização>/<identidade>/`, e o ponteiro
 * na própria identidade. Não passam por `storage_files`: aquela tabela é do
 * mundo interno (quem envia é um `User`), e abrir escrita nela para o ator do
 * portal seria dar a ele uma porta para o storage inteiro da organização. Aqui
 * a única escrita é a função `app_customer_portal_set_media`, que só aceita a
 * sessão válida da própria identidade.
 *
 * ## Por que a assinatura é só cadastrada
 *
 * Nesta versão o cliente guarda a assinatura, e ninguém a usa ainda. Assinar
 * documento pelo app é a próxima etapa — e vai exigir o consentimento por
 * documento, não o reaproveitamento silencioso desta imagem.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { UnauthorizedException, ValidationException } from '../../exceptions';
import { detectImageMime } from '../storage/image-signature';
import { ImageOptimizationService } from '../storage/image-optimization.service';
import {
  STORAGE_PROVIDER,
  type StorageProvider,
} from '../storage/storage.types';
import { CustomerPortalRepository } from './customer-portal.repository';
import type {
  CustomerPortalMediaReadModel,
  CustomerPortalProfileReadModel,
} from './customer-portal.read-models';
import type {
  CustomerPortalActor,
  PortalMediaKind,
} from './customer-portal.types';

/** A assinatura é traço sobre fundo transparente: pequena por natureza. */
export const SIGNATURE_MAX_BYTES = 2_000_000;
const SIGNATURE_MAX_SIDE = 2_000;
const SIGNED_URL_SECONDS = 300;

const vazio: CustomerPortalMediaReadModel = {
  available: false,
  url: null,
  expiresAt: null,
  updatedAt: null,
};

@Injectable()
export class CustomerPortalProfileService {
  private readonly logger = new Logger(CustomerPortalProfileService.name);

  constructor(
    private readonly repository: CustomerPortalRepository,
    private readonly images: ImageOptimizationService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  async view(
    actor: CustomerPortalActor,
  ): Promise<CustomerPortalProfileReadModel> {
    const state = await this.repository.profileState(
      actor.identityId,
      actor.sessionId,
    );
    if (!state) throw new UnauthorizedException();
    const [avatar, signature] = await Promise.all([
      this.signed(
        state.avatarBucket,
        state.avatarObjectKey,
        state.avatarUpdatedAt,
        'image/webp',
      ),
      this.signed(
        state.signatureBucket,
        state.signatureObjectKey,
        state.signatureUpdatedAt,
        'image/png',
      ),
    ]);
    return { avatar, signature };
  }

  /** Foto: qualquer imagem aceita, reduzida a 512px em WebP. */
  async setAvatar(
    actor: CustomerPortalActor,
    file: { buffer: Buffer; mimetype: string } | undefined,
  ): Promise<CustomerPortalProfileReadModel> {
    if (!file?.buffer?.length) {
      throw new ValidationException(
        'Envie uma foto.',
        undefined,
        'FILE_REQUIRED',
      );
    }
    const body = await this.images.optimize(file.buffer, file.mimetype, true);
    await this.replace(actor, 'AVATAR', body, 'image/webp', 'webp');
    return this.view(actor);
  }

  /**
   * Assinatura: só PNG, como sai do quadro de assinatura do app.
   *
   * Recodificada antes de guardar: metadados saem, e o que fica é exatamente
   * a imagem que se vê — o mesmo cuidado de qualquer arquivo que um dia vai
   * parar num documento.
   */
  async setSignature(
    actor: CustomerPortalActor,
    file: { buffer: Buffer; mimetype: string } | undefined,
  ): Promise<CustomerPortalProfileReadModel> {
    if (!file?.buffer?.length) {
      throw new ValidationException(
        'Desenhe a assinatura antes de salvar.',
        undefined,
        'FILE_REQUIRED',
      );
    }
    if (file.buffer.length > SIGNATURE_MAX_BYTES) {
      throw new ValidationException(
        'A assinatura deve ter até 2 MB.',
        undefined,
        'FILE_TOO_LARGE',
      );
    }
    if (detectImageMime(file.buffer) !== 'image/png') {
      throw new ValidationException(
        'A assinatura deve ser uma imagem PNG.',
        undefined,
        'FILE_INVALID',
      );
    }
    let body: Buffer;
    try {
      const imagem = sharp(file.buffer, {
        limitInputPixels: SIGNATURE_MAX_SIDE * SIGNATURE_MAX_SIDE,
        failOn: 'warning',
      });
      const { width = 0, height = 0 } = await imagem.metadata();
      if (width < 16 || height < 16) throw new Error('too small');
      body = await imagem
        .resize({
          width: SIGNATURE_MAX_SIDE,
          height: SIGNATURE_MAX_SIDE,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .png()
        .toBuffer();
    } catch {
      throw new ValidationException(
        'Não foi possível ler a assinatura. Desenhe de novo e salve.',
        undefined,
        'FILE_INVALID',
      );
    }
    await this.replace(actor, 'SIGNATURE', body, 'image/png', 'png');
    return this.view(actor);
  }

  async remove(
    actor: CustomerPortalActor,
    kind: PortalMediaKind,
  ): Promise<CustomerPortalProfileReadModel> {
    const previous = await this.repository.setMedia(
      actor.identityId,
      actor.sessionId,
      kind,
      null,
    );
    if (!previous) throw new UnauthorizedException();
    await this.discard(previous.previousBucket, previous.previousObjectKey);
    return this.view(actor);
  }

  /**
   * Grava o objeto novo antes de apontar para ele, e só então apaga o antigo.
   *
   * Na ordem inversa, uma falha no meio deixaria o perfil apontando para um
   * objeto que não existe. Nesta, o pior caso é um objeto órfão — que a
   * limpeza remove.
   */
  private async replace(
    actor: CustomerPortalActor,
    kind: PortalMediaKind,
    body: Buffer,
    mimeType: string,
    extension: string,
  ): Promise<void> {
    const bucket = this.storage.defaultBucket;
    const objectKey = [
      'customer-portal',
      actor.organizationId,
      actor.identityId,
      kind === 'AVATAR' ? 'avatar' : 'signature',
      `${randomUUID()}.${extension}`,
    ].join('/');
    await this.storage.put({ bucket, objectKey, body, mimeType });
    const previous = await this.repository.setMedia(
      actor.identityId,
      actor.sessionId,
      kind,
      { bucket, objectKey },
    );
    if (!previous) {
      await this.discard(bucket, objectKey);
      throw new UnauthorizedException();
    }
    await this.discard(previous.previousBucket, previous.previousObjectKey);
  }

  private async discard(bucket: string | null, objectKey: string | null) {
    if (!bucket || !objectKey) return;
    try {
      await this.storage.remove({ bucket, objectKey });
    } catch (error) {
      /* O perfil já aponta para o novo; o antigo vira órfão, e não erro. */
      this.logger.warn(
        JSON.stringify({
          event: 'customer_portal_media_discard_failed',
          reason: error instanceof Error ? error.name : 'unknown',
        }),
      );
    }
  }

  private async signed(
    bucket: string | null,
    objectKey: string | null,
    updatedAt: Date | null,
    mimeType: string,
  ): Promise<CustomerPortalMediaReadModel> {
    if (!bucket || !objectKey) return vazio;
    const signed = await this.storage.sign({
      bucket,
      objectKey,
      operation: 'preview',
      expiresInSeconds: SIGNED_URL_SECONDS,
      mimeType,
    });
    return {
      available: true,
      url: signed.url,
      expiresAt: signed.expiresAt.toISOString(),
      updatedAt: updatedAt?.toISOString() ?? null,
    };
  }
}

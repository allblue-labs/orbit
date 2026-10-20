/**
 * A foto de perfil.
 *
 * ## O que ela é, e o que não é
 *
 * É um arquivo como qualquer outro do produto: reservado, enviado por URL
 * assinada, **conferido pelos primeiros bytes**, com hash e ciclo de vida. O
 * que a coluna `users.avatar_storage_file_id` guarda é a referência — nunca o
 * binário, e nunca uma URL permanente.
 *
 * Ela **não** é assinatura. Assinatura profissional é `UserSignature`,
 * versionada e usada em documento; foto é decoração de identidade e a versão
 * anterior não interessa a ninguém. Fundir as duas daria à foto um histórico
 * que ninguém consulta e à assinatura um ciclo de vida que ela não pode ter.
 *
 * ## A leitura é temporária, sempre
 *
 * O endereço devolvido expira. Publicar uma URL permanente transformaria a
 * foto num objeto acessível a quem descobrisse o endereço, para sempre — e
 * "para sempre" inclui depois de a pessoa sair da empresa.
 */
import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  EntityNotFoundException,
  ValidationException,
} from '../../../exceptions';
import {
  FileObjectService,
  STORAGE_NAMESPACES,
} from '../../storage/file-object.service';
import { detectImageMime } from '../../storage/image-signature';
import { AvatarRepository } from '../infrastructure/avatar.repository';

/**
 * Teto do arquivo.
 *
 * Uma foto de perfil é exibida em 40 pixels na maior parte das telas. Dois
 * megabytes já é generoso — o limite existe para que ninguém use o campo como
 * depósito, não para acomodar a foto original da câmera.
 */
export const AVATAR_MAX_BYTES = 2_000_000;

export interface AvatarView {
  available: boolean;
  /** Temporária. Nula quando não há foto. */
  url: string | null;
  expiresAt: string | null;
  updatedAt: string | null;
}

@Injectable()
export class AvatarService {
  private readonly logger = new Logger(AvatarService.name);

  constructor(
    private readonly repository: AvatarRepository,
    private readonly files: FileObjectService,
  ) {}

  /** Reserva o destino do upload. Nada muda no perfil ainda. */
  async reserveUpload(
    actor: { id: string; organizationId: string },
    input: { fileName: string; mimeType: string; sizeBytes: number },
  ) {
    const { file, signed } = await this.files.reserve({
      organizationId: actor.organizationId,
      businessUnitId: null,
      namespace: STORAGE_NAMESPACES.avatar,
      fileName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      metadata: { purpose: 'USER_AVATAR', ownerUserId: actor.id },
      createdById: actor.id,
    });
    return {
      fileId: file.id,
      upload: {
        url: signed.url,
        expiresAt: signed.expiresAt.toISOString(),
        method: 'PUT' as const,
        requiredHeaders: signed.requiredHeaders,
      },
    };
  }

  /**
   * Confirma o upload e passa a ser a foto.
   *
   * A conferência acontece **depois** de o arquivo estar no storage, sobre os
   * bytes que ficaram lá — e não sobre o que o cliente prometeu enviar. Entre
   * a promessa e a gravação cabe outro conteúdo.
   */
  async activate(
    actor: { id: string; organizationId: string },
    storageObjectId: string,
  ): Promise<AvatarView> {
    const reserved = await this.repository.reservedFile(
      actor.organizationId,
      storageObjectId,
    );

    /**
     * Só o dono do upload. Sem isto, quem descobrisse o id de um arquivo de
     * outra pessoa poderia adotá-lo como a própria foto — e passaria a ler,
     * pela URL assinada da própria conta, um objeto que não é dele.
     */
    if (!reserved || reserved.createdById !== actor.id)
      throw new EntityNotFoundException('StorageFile', storageObjectId);

    await this.files.confirm(storageObjectId, actor.organizationId);
    const file = await this.repository.availableFile(
      actor.organizationId,
      storageObjectId,
    );
    if (!file || file.createdById !== actor.id || !file.sha256)
      throw new ValidationException(
        'A foto deve pertencer ao usuário autenticado e estar disponível',
      );
    if (file.sizeBytes > BigInt(AVATAR_MAX_BYTES))
      throw new ValidationException(
        'A foto deve ter no máximo 2 MB',
        undefined,
        'FILE_TOO_LARGE',
      );

    const body = await this.files.read(file.bucket, file.objectKey);
    const detected = detectImageMime(body);
    if (!detected || detected !== file.mimeType)
      throw new ValidationException(
        'A foto deve ser PNG, JPEG ou WEBP válido',
        undefined,
        'FILE_INVALID',
      );
    if (
      body.length > AVATAR_MAX_BYTES ||
      createHash('sha256').update(body).digest('hex') !== file.sha256
    )
      throw new ValidationException(
        'O conteúdo da foto não corresponde ao arquivo confirmado',
      );

    const previous = await this.repository.attach(actor.id, file.id);

    /**
     * A foto anterior sai do caminho.
     *
     * Ela não é histórico de nada — ninguém audita foto de perfil. Deixá-la no
     * storage seria acumular objetos que nenhuma tela alcança, e cada um deles
     * continua sendo uma imagem de uma pessoa real guardada sem motivo.
     */
    if (previous && previous !== file.id) {
      await this.discard(actor.organizationId, previous);
    }

    this.logger.log(
      JSON.stringify({
        metric: 'user_avatar_changed_total',
      }),
    );
    return this.view(actor);
  }

  /** Remove a foto. As iniciais voltam. */
  async remove(actor: {
    id: string;
    organizationId: string;
  }): Promise<AvatarView> {
    const previous = await this.repository.detach(actor.id);
    if (previous) await this.discard(actor.organizationId, previous);
    return { available: false, url: null, expiresAt: null, updatedAt: null };
  }

  /**
   * A foto atual, com endereço temporário.
   *
   * Devolve "sem foto" quando o arquivo não é alcançável no contexto atual —
   * o caso de quem enviou a foto por outra organização. É melhor mostrar as
   * iniciais do que um endereço quebrado.
   */
  async view(actor: {
    id: string;
    organizationId: string;
  }): Promise<AvatarView> {
    const user = await this.repository.currentAvatar(actor.id);
    if (!user?.avatarStorageFileId)
      return { available: false, url: null, expiresAt: null, updatedAt: null };

    const file = await this.repository.availableFile(
      actor.organizationId,
      user.avatarStorageFileId,
    );
    if (!file)
      return { available: false, url: null, expiresAt: null, updatedAt: null };

    const signed = await this.files.sign(file, 'download');
    return {
      available: true,
      url: signed.url,
      expiresAt: signed.expiresAt.toISOString(),
      updatedAt: file.updatedAt.toISOString(),
    };
  }

  /**
   * Apaga o objeto anterior sem derrubar a troca.
   *
   * A foto nova já está no perfil quando isto roda. Se o provider recusar a
   * remoção, o que sobra é um objeto órfão — problema de limpeza, não de
   * produto; deixar o erro subir devolveria falha para quem acabou de trocar
   * a foto com sucesso.
   */
  private async discard(organizationId: string, fileId: string) {
    try {
      const file = await this.repository.availableFile(organizationId, fileId);
      if (!file) return;
      await this.files.remove(file.bucket, file.objectKey);
      await this.repository.softDeleteFile(organizationId, fileId);
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          stage: 'avatar-discard-failed',
          organizationId,
          reason: error instanceof Error ? error.name : 'unknown',
        }),
      );
    }
  }
}

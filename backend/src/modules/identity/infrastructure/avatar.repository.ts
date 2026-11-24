import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { withIdentity } from '../../../database/rls/identity-scope';
import { RlsTransaction } from '../../../database/rls/rls-transaction';

@Injectable()
export class AvatarRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rls: RlsTransaction,
  ) {}

  /** O arquivo reservado, antes de existir conteúdo confirmado. */
  reservedFile(organizationId: string, id: string) {
    return this.rls.run((tx) =>
      tx.storageFile.findFirst({
        where: {
          id,
          organizationId,
          deletedAt: null,
          metadata: { path: ['purpose'], equals: 'USER_AVATAR' },
        },
        select: { id: true, createdById: true },
      }),
    );
  }

  /** O arquivo já confirmado e legível. */
  availableFile(organizationId: string, id: string) {
    return this.rls.run((tx) =>
      tx.storageFile.findFirst({
        where: { id, organizationId, status: 'AVAILABLE', deletedAt: null },
      }),
    );
  }

  currentAvatar(userId: string) {
    return withIdentity(this.prisma, userId, (tx) =>
      tx.user.findUnique({
        where: { id: userId },
        select: { avatarStorageFileId: true },
      }),
    );
  }

  /**
   * Aponta o perfil para o arquivo novo e devolve o anterior.
   *
   * Devolve o anterior porque quem chama precisa dele para limpar o storage —
   * e ler antes de escrever, aqui, é a única forma de saber qual era.
   */
  async attach(userId: string, fileId: string): Promise<string | null> {
    const previous = await this.currentAvatar(userId);
    await withIdentity(this.prisma, userId, (tx) =>
      tx.user.update({
        where: { id: userId },
        data: { avatarStorageFileId: fileId },
        select: { id: true },
      }),
    );
    return previous?.avatarStorageFileId ?? null;
  }

  async detach(userId: string): Promise<string | null> {
    const previous = await this.currentAvatar(userId);
    if (!previous?.avatarStorageFileId) return null;
    await withIdentity(this.prisma, userId, (tx) =>
      tx.user.update({
        where: { id: userId },
        data: { avatarStorageFileId: null },
        select: { id: true },
      }),
    );
    return previous.avatarStorageFileId;
  }

  /**
   * Marca o registro como apagado depois que o objeto saiu do provider.
   *
   * Nesta ordem de propósito: um registro vivo apontando para um objeto que
   * não existe mais produz erro na leitura seguinte; um registro apagado
   * apontando para um objeto que ainda existe produz, no pior caso, um objeto
   * órfão — que a limpeza de storage resolve.
   */
  softDeleteFile(organizationId: string, id: string) {
    return this.rls.run((tx) =>
      tx.storageFile.updateMany({
        where: { id, organizationId, deletedAt: null },
        data: { deletedAt: new Date() },
      }),
    );
  }
}

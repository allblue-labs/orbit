/**
 * Persistência da foto de perfil.
 *
 * Duas tabelas com donos diferentes, e por isso dois caminhos de acesso:
 * `storage_files` é do inquilino e tem RLS forçada — toda leitura passa pela
 * transação com a organização declarada. `users` é global (a mesma pessoa
 * pertence a mais de uma organização) e é lida pelo cliente comum, como o
 * resto do módulo de identidade já faz.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
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
        where: { id, organizationId, deletedAt: null },
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
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: { avatarStorageFileId: true },
    });
  }

  /**
   * Aponta o perfil para o arquivo novo e devolve o anterior.
   *
   * Devolve o anterior porque quem chama precisa dele para limpar o storage —
   * e ler antes de escrever, aqui, é a única forma de saber qual era.
   */
  async attach(userId: string, fileId: string): Promise<string | null> {
    const previous = await this.currentAvatar(userId);
    await this.prisma.user.update({
      where: { id: userId },
      data: { avatarStorageFileId: fileId },
      select: { id: true },
    });
    return previous?.avatarStorageFileId ?? null;
  }

  async detach(userId: string): Promise<string | null> {
    const previous = await this.currentAvatar(userId);
    if (!previous?.avatarStorageFileId) return null;
    await this.prisma.user.update({
      where: { id: userId },
      data: { avatarStorageFileId: null },
      select: { id: true },
    });
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

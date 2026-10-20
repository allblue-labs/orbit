import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService, RlsTransaction } from '../../../database';
import { generateUuidV7 } from '../../../utils';
import type {
  CreateBusinessUnitDto,
  UpdateBusinessUnitDto,
} from '../dto/organization.dto';

@Injectable()
export class BusinessUnitRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rls: RlsTransaction,
  ) {}

  list(organizationId: string) {
    return this.rls.run((transaction) =>
      transaction.businessUnit.findMany({
        where: { organizationId, deletedAt: null },
        orderBy: [{ isPrimary: 'desc' }, { legalName: 'asc' }],
      }),
    );
  }

  find(id: string, organizationId: string) {
    return this.rls.run((transaction) =>
      transaction.businessUnit.findFirst({
        where: { id, organizationId, deletedAt: null },
      }),
    );
  }

  create(
    organizationId: string,
    actorUserId: string,
    accessibleUnitIds: readonly string[],
    roleId: string,
    input: CreateBusinessUnitDto,
    slug: string,
  ) {
    const id = generateUuidV7();
    return this.prisma.$transaction(async (transaction) => {
      await this.setLocal(transaction, 'app.user_id', actorUserId);
      await this.setLocal(transaction, 'app.organization_id', organizationId);
      await this.setLocal(
        transaction,
        'app.business_unit_ids',
        [...new Set([...accessibleUnitIds, id])].join(','),
      );
      if (input.isPrimary) {
        await transaction.businessUnit.updateMany({
          where: { organizationId, isPrimary: true, deletedAt: null },
          data: { isPrimary: false },
        });
      }
      const unit = await transaction.businessUnit.create({
        data: {
          id,
          organizationId,
          parentId: input.parentId,
          slug,
          code: input.code,
          type: input.type,
          isPrimary: input.isPrimary,
          legalName: input.legalName,
          tradeName: input.tradeName,
          documentType: input.documentType,
          documentNumber: input.documentNumber,
          city: input.city,
          street: input.street,
          number: input.number,
          stateCode: input.stateCode,
          postalCode: input.postalCode,
          email: input.email,
          phone: input.phone,
        },
      });
      await transaction.businessUnitMembership.create({
        data: {
          organizationId,
          businessUnitId: id,
          userId: actorUserId,
          roleId,
        },
      });
      return unit;
    });
  }

  update(
    id: string,
    organizationId: string,
    input: UpdateBusinessUnitDto,
    slug?: string,
  ) {
    return this.rls.run(async (transaction) => {
      if (input.isPrimary) {
        await transaction.businessUnit.updateMany({
          where: {
            organizationId,
            id: { not: id },
            isPrimary: true,
            deletedAt: null,
          },
          data: { isPrimary: false },
        });
      }
      return transaction.businessUnit.update({
        where: { id },
        data: { ...input, slug },
      });
    });
  }

  /**
   * Grava (ou apaga) a marca da unidade.
   *
   * Escrita própria em vez de passar pelo `update` geral: aquele monta o slug,
   * mexe em `isPrimary` e roda numa transação que reordena irmãs. Trocar uma
   * imagem não precisa de nada disso, e passar por lá faria uma troca de logo
   * disputar as mesmas linhas que uma edição de cadastro.
   */
  setLogo(id: string, logoUrl: string | null) {
    return this.rls.run((transaction) =>
      transaction.businessUnit.update({
        where: { id },
        data: { logoUrl },
        select: { id: true, logoUrl: true },
      }),
    );
  }

  softDelete(id: string): Promise<void> {
    return this.rls
      .run((transaction) =>
        transaction.businessUnit.update({
          where: { id },
          data: { deletedAt: new Date(), status: 'INACTIVE' },
        }),
      )
      .then(() => undefined);
  }

  findActorRole(organizationId: string, userId: string) {
    return this.rls.run((transaction) =>
      transaction.organizationMembership.findFirst({
        where: {
          organizationId,
          userId,
          status: 'ACTIVE',
          deletedAt: null,
        },
        select: { roleId: true },
      }),
    );
  }

  private setLocal(
    transaction: Prisma.TransactionClient,
    key: string,
    value: string,
  ): Promise<unknown> {
    return transaction.$queryRawUnsafe(
      'SELECT set_config($1, $2, true)',
      key,
      value,
    );
  }
}

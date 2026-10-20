import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { RlsTransaction } from '../../../../database';
import { PaginationHelper } from '../../../../database/helpers/database.helpers';
import type { AssetQueryDto } from './asset.dto';
import {
  allocateInternalCode,
  isGeneratedIdentifierType,
} from './asset-internal-code';

const assetInclude = {
  businessUnit: {
    select: { id: true, legalName: true, tradeName: true },
  },
  customer: {
    select: { id: true, legalName: true, tradeName: true, status: true },
  },
} satisfies Prisma.AssetInclude;

@Injectable()
export class AssetRepository {
  constructor(private readonly rls: RlsTransaction) {}

  list(organizationId: string, query: AssetQueryDto) {
    const pagination = PaginationHelper.normalize(query.page, query.limit);
    const where: Prisma.AssetWhereInput = {
      organizationId,
      deletedAt: null,
      businessUnitId: query.businessUnitId,
      customerId: query.customerId,
      category: query.category,
      status: query.status,
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { identifier: { contains: query.search, mode: 'insensitive' } },
              {
                serialNumber: {
                  contains: query.search,
                  mode: 'insensitive',
                },
              },
              { manufacturer: { contains: query.search, mode: 'insensitive' } },
              { model: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    return this.rls.run(async (transaction) => {
      const data = await transaction.asset.findMany({
        where,
        include: assetInclude,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        ...PaginationHelper.toPrisma(pagination),
      });
      const total = await transaction.asset.count({ where });
      return PaginationHelper.result(data, total, pagination);
    });
  }

  find(id: string, organizationId: string) {
    return this.rls.run((transaction) =>
      transaction.asset.findFirst({
        where: { id, organizationId, deletedAt: null },
        include: assetInclude,
      }),
    );
  }

  findByIdentifier(identifier: string, organizationId: string) {
    return this.rls.run((transaction) =>
      transaction.asset.findFirst({
        where: { identifier, organizationId, deletedAt: null },
        include: assetInclude,
      }),
    );
  }

  /**
   * Cria um equipamento e, quando o identificador é **código interno** sem valor,
   * gera um.
   *
   * A reserva mora aqui porque é a fronteira por onde o cadastro de equipamento
   * passa, e na mesma transação da criação: um equipamento sem código, ou um
   * número consumido sem equipamento, seriam duas formas de furar a contagem.
   *
   * Os outros tipos de identificador passam intactos — eles são lidos da máquina,
   * e gerar um número de série inventaria um fato sobre o equipamento do cliente.
   * Código interno digitado também passa: quem etiquetou o parque antes de usar o
   * Orbit tem a convenção dele.
   */
  create(data: Prisma.AssetUncheckedCreateInput) {
    return this.rls.run(async (transaction) => {
      const identifier =
        isGeneratedIdentifierType(data.identifierType) && !data.identifier
          ? await allocateInternalCode(transaction, data.organizationId)
          : data.identifier;

      return transaction.asset.create({
        data: { ...data, identifier },
        include: assetInclude,
      });
    });
  }

  update(id: string, data: Prisma.AssetUpdateInput) {
    return this.rls.run((transaction) =>
      transaction.asset.update({ where: { id }, data, include: assetInclude }),
    );
  }

  softDelete(id: string): Promise<void> {
    return this.rls
      .run((transaction) =>
        transaction.asset.update({
          where: { id },
          data: { status: 'RETIRED', deletedAt: new Date() },
        }),
      )
      .then(() => undefined);
  }

  findBusinessUnit(id: string, organizationId: string) {
    return this.rls.run((transaction) =>
      transaction.businessUnit.findFirst({
        where: { id, organizationId, deletedAt: null, status: 'ACTIVE' },
        select: { id: true },
      }),
    );
  }

  findCustomer(id: string, organizationId: string) {
    return this.rls.run((transaction) =>
      transaction.customer.findFirst({
        where: { id, organizationId, deletedAt: null, status: 'ACTIVE' },
        select: { id: true },
      }),
    );
  }
}

import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { RlsTransaction } from '../../database';
import { PaginationHelper } from '../../database/helpers/database.helpers';
import type { CatalogQueryDto } from './catalog.dto';
import { allocateProductSku } from './product-sku';

const productInclude = {
  category: {
    select: { id: true, name: true, slug: true },
  },
  businessUnit: {
    select: { id: true, legalName: true, tradeName: true },
  },
} satisfies Prisma.ProductInclude;

@Injectable()
export class CatalogRepository {
  constructor(private readonly rls: RlsTransaction) {}

  listCategories(organizationId: string) {
    return this.rls.run((transaction) =>
      transaction.productCategory.findMany({
        where: { organizationId, deletedAt: null },
        orderBy: { name: 'asc' },
      }),
    );
  }

  findCategory(id: string, organizationId: string) {
    return this.rls.run((transaction) =>
      transaction.productCategory.findFirst({
        where: { id, organizationId, deletedAt: null },
      }),
    );
  }

  createCategory(data: Prisma.ProductCategoryUncheckedCreateInput) {
    return this.rls.run((transaction) =>
      transaction.productCategory.create({ data }),
    );
  }

  updateCategory(id: string, data: Prisma.ProductCategoryUpdateInput) {
    return this.rls.run((transaction) =>
      transaction.productCategory.update({ where: { id }, data }),
    );
  }

  categoryDependencies(id: string) {
    return this.rls.run(async (transaction) => {
      const children = await transaction.productCategory.count({
        where: { parentId: id, deletedAt: null },
      });
      const products = await transaction.product.count({
        where: { categoryId: id, deletedAt: null },
      });
      return { children, products };
    });
  }

  softDeleteCategory(id: string): Promise<void> {
    return this.rls
      .run((transaction) =>
        transaction.productCategory.update({
          where: { id },
          data: { deletedAt: new Date() },
        }),
      )
      .then(() => undefined);
  }

  listProducts(organizationId: string, query: CatalogQueryDto) {
    const pagination = PaginationHelper.normalize(query.page, query.limit);
    const where: Prisma.ProductWhereInput = {
      organizationId,
      deletedAt: null,
      kind: query.kind,
      categoryId: query.categoryId,
      businessUnitId: query.businessUnitId,
      status: query.status,
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { sku: { contains: query.search, mode: 'insensitive' } },
              { description: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    return this.rls.run(async (transaction) => {
      const data = await transaction.product.findMany({
        where,
        include: productInclude,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        ...PaginationHelper.toPrisma(pagination),
      });
      const total = await transaction.product.count({ where });
      return PaginationHelper.result(data, total, pagination);
    });
  }

  findProduct(id: string, organizationId: string) {
    return this.rls.run((transaction) =>
      transaction.product.findFirst({
        where: { id, organizationId, deletedAt: null },
        include: productInclude,
      }),
    );
  }

  findAvailableProduct(
    id: string,
    organizationId: string,
    businessUnitId: string,
  ) {
    return this.rls.run((transaction) =>
      transaction.product.findFirst({
        where: {
          id,
          organizationId,
          deletedAt: null,
          status: 'ACTIVE',
          OR: [{ businessUnitId: null }, { businessUnitId }],
        },
        include: productInclude,
      }),
    );
  }

  /**
   * Cria um item e, quando não vem código, **reserva um**.
   *
   * A reserva mora aqui porque é a fronteira por onde todo item de catálogo nasce
   * — e na mesma transação da criação: um item sem código, ou um código sem item,
   * seriam duas formas de quebrar a contagem do fluxo.
   *
   * Código digitado passa intacto. Quem vem de outro sistema importa os códigos
   * antigos, e sobrescrevê-los faria o catálogo novo não conversar com a nota
   * fiscal antiga.
   */
  createProduct(data: Prisma.ProductUncheckedCreateInput) {
    return this.rls.run(async (transaction) => {
      const sku =
        data.sku ??
        (await allocateProductSku(
          transaction,
          data.organizationId,
          data.kind ?? 'PRODUCT',
        ));

      return transaction.product.create({
        data: { ...data, sku },
        include: productInclude,
      });
    });
  }

  updateProduct(id: string, data: Prisma.ProductUpdateInput) {
    return this.rls.run((transaction) =>
      transaction.product.update({
        where: { id },
        data,
        include: productInclude,
      }),
    );
  }

  softDeleteProduct(id: string): Promise<void> {
    return this.rls
      .run((transaction) =>
        transaction.product.update({
          where: { id },
          data: { deletedAt: new Date(), status: 'INACTIVE' },
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
}

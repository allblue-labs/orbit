import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { RlsTransaction } from '../../../../database';
import { PaginationHelper } from '../../../../database/helpers/database.helpers';
import type { CustomerQueryDto } from './customer.dto';

const customerInclude = {
  contacts: {
    where: { deletedAt: null },
    orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }],
  },
  _count: {
    select: {
      assets: { where: { deletedAt: null } },
      operations: { where: { deletedAt: null } },
    },
  },
} satisfies Prisma.CustomerInclude;

@Injectable()
export class CustomerRepository {
  constructor(private readonly rls: RlsTransaction) {}

  list(organizationId: string, query: CustomerQueryDto) {
    const pagination = PaginationHelper.normalize(query.page, query.limit);
    const search = query.search?.trim();
    // Only a document-shaped term may match its normalized digits. Using an
    // empty string here matches every customer with a document, hiding the
    // actual name matches beyond the first page.
    const document =
      search && /^[\d./\s-]+$/.test(search) ? search.replace(/\D/g, '') : '';
    const where: Prisma.CustomerWhereInput = {
      organizationId,
      deletedAt: null,
      type: query.type,
      status: query.status,
      ...(search
        ? {
            OR: [
              { legalName: { contains: search, mode: 'insensitive' } },
              { tradeName: { contains: search, mode: 'insensitive' } },
              ...(document ? [{ documentNumber: { contains: document } }] : []),
              { email: { contains: search, mode: 'insensitive' } },
              { phone: { contains: search } },
            ],
          }
        : {}),
    };
    return this.rls.run(async (transaction) => {
      const data = await transaction.customer.findMany({
        where,
        include: customerInclude,
        orderBy: [{ legalName: 'asc' }, { id: 'asc' }],
        ...PaginationHelper.toPrisma(pagination),
      });
      const total = await transaction.customer.count({ where });
      return PaginationHelper.result(data, total, pagination);
    });
  }

  find(id: string, organizationId: string) {
    return this.rls.run((transaction) =>
      transaction.customer.findFirst({
        where: { id, organizationId, deletedAt: null },
        include: customerInclude,
      }),
    );
  }

  /**
   * Cria o cliente e, quando há endereço, o primeiro endereço de atendimento.
   *
   * ## Por que os dois juntos
   *
   * `Customer.address` é o endereço **fiscal** — um JSON livre que sai em
   * documento. `CustomerAddress` é para onde o técnico vai, e é o que a aba
   * Endereços lista e o que uma operação referencia.
   *
   * Eram coisas separadas no código e a mesma coisa para quem cadastra: o dono
   * preenchia o endereço ao criar o cliente, abria a aba Endereços e a
   * encontrava vazia. Depois precisava digitar tudo de novo para que o
   * atendimento tivesse para onde ir.
   *
   * Na mesma transação porque meio-cadastro é pior que nenhum: um cliente com
   * endereço fiscal e sem endereço de atendimento é exatamente o estado que
   * esta função existe para não produzir.
   */
  create(
    data: Prisma.CustomerUncheckedCreateInput,
    endereco?: {
      label: string;
      street: string;
      city: string;
      number?: string;
      complement?: string;
      district?: string;
      stateCode?: string;
      postalCode?: string;
    },
  ) {
    return this.rls.run(async (transaction) => {
      const customer = await transaction.customer.create({
        data,
        include: customerInclude,
      });

      if (endereco) {
        await transaction.customerAddress.create({
          data: {
            organizationId: customer.organizationId,
            customerId: customer.id,
            ...endereco,
            /* O primeiro é o principal: não há outro para disputar o posto. */
            isPrimary: true,
          },
        });
      }

      return customer;
    });
  }

  update(id: string, data: Prisma.CustomerUpdateInput) {
    return this.rls.run((transaction) =>
      transaction.customer.update({
        where: { id },
        data,
        include: customerInclude,
      }),
    );
  }

  softDelete(id: string): Promise<void> {
    return this.rls
      .run(async (transaction) => {
        const now = new Date();
        await transaction.contact.updateMany({
          where: { customerId: id, deletedAt: null },
          data: { deletedAt: now },
        });
        await transaction.customer.update({
          where: { id },
          data: { status: 'INACTIVE', deletedAt: now },
        });
      })
      .then(() => undefined);
  }

  /* ---------------------------------------------------------------- */
  /* Endereços de atendimento                                          */
  /* ---------------------------------------------------------------- */

  listAddresses(customerId: string, onlyActive = false) {
    return this.rls.run((transaction) =>
      transaction.customerAddress.findMany({
        where: {
          customerId,
          deletedAt: null,
          ...(onlyActive ? { isActive: true } : {}),
        },
        orderBy: [{ isPrimary: 'desc' }, { label: 'asc' }],
      }),
    );
  }

  findAddress(id: string, customerId: string) {
    return this.rls.run((transaction) =>
      transaction.customerAddress.findFirst({
        where: { id, customerId, deletedAt: null },
      }),
    );
  }

  /**
   * Cria o endereço e, quando ele é o principal, tira o posto do anterior.
   *
   * Dois endereços marcados como principal deixariam a escolha do padrão ao
   * acaso da ordenação — e é justamente o padrão que o formulário de
   * atendimento usa quando ninguém escolhe.
   */
  createAddress(data: {
    organizationId: string;
    customerId: string;
    label: string;
    street: string;
    city: string;
    number?: string;
    complement?: string;
    district?: string;
    stateCode?: string;
    postalCode?: string;
    notes?: string;
    isPrimary?: boolean;
  }) {
    return this.rls.run(async (transaction) => {
      const primeiro =
        (await transaction.customerAddress.count({
          where: { customerId: data.customerId, deletedAt: null },
        })) === 0;
      const principal = data.isPrimary ?? primeiro;

      if (principal) {
        await transaction.customerAddress.updateMany({
          where: { customerId: data.customerId, isPrimary: true },
          data: { isPrimary: false },
        });
      }
      return transaction.customerAddress.create({
        data: { ...data, isPrimary: principal },
      });
    });
  }

  updateAddress(
    id: string,
    customerId: string,
    data: {
      label?: string;
      street?: string;
      city?: string;
      number?: string;
      complement?: string;
      district?: string;
      stateCode?: string;
      postalCode?: string;
      notes?: string;
      isPrimary?: boolean;
      isActive?: boolean;
    },
  ) {
    return this.rls.run(async (transaction) => {
      if (data.isPrimary) {
        await transaction.customerAddress.updateMany({
          where: { customerId, isPrimary: true, id: { not: id } },
          data: { isPrimary: false },
        });
      }
      return transaction.customerAddress.update({ where: { id }, data });
    });
  }

  /**
   * Remoção é lógica.
   *
   * Atendimentos passados apontam para o endereço, e um relatório de período
   * anterior precisa continuar dizendo onde o técnico esteve.
   */
  softDeleteAddress(id: string) {
    return this.rls.run((transaction) =>
      transaction.customerAddress.update({
        where: { id },
        data: { deletedAt: new Date(), isActive: false, isPrimary: false },
      }),
    );
  }

  listContacts(customerId: string) {
    return this.rls.run((transaction) =>
      transaction.contact.findMany({
        where: { customerId, deletedAt: null },
        include: {
          businessUnit: {
            select: { id: true, legalName: true, tradeName: true },
          },
        },
        orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }],
      }),
    );
  }

  findContact(id: string, customerId: string, organizationId: string) {
    return this.rls.run((transaction) =>
      transaction.contact.findFirst({
        where: { id, customerId, organizationId, deletedAt: null },
      }),
    );
  }

  createContact(data: Prisma.ContactUncheckedCreateInput) {
    return this.rls.run(async (transaction) => {
      if (data.isPrimary) {
        await transaction.contact.updateMany({
          where: {
            customerId: data.customerId,
            organizationId: data.organizationId,
            deletedAt: null,
            isPrimary: true,
          },
          data: { isPrimary: false },
        });
      }
      return transaction.contact.create({ data });
    });
  }

  updateContact(
    id: string,
    customerId: string,
    organizationId: string,
    data: Prisma.ContactUpdateInput,
  ) {
    return this.rls.run(async (transaction) => {
      if (data.isPrimary === true) {
        await transaction.contact.updateMany({
          where: {
            id: { not: id },
            customerId,
            organizationId,
            deletedAt: null,
            isPrimary: true,
          },
          data: { isPrimary: false },
        });
      }
      return transaction.contact.update({ where: { id }, data });
    });
  }

  softDeleteContact(id: string): Promise<void> {
    return this.rls
      .run((transaction) =>
        transaction.contact.update({
          where: { id },
          data: { deletedAt: new Date(), isPrimary: false },
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

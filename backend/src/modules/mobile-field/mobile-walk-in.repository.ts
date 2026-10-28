import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RlsTransaction } from '../../database';
import { generateUuidV7 } from '../../utils';
import { OperationRepository } from '../operations/operation.repository';
import type { CreateWalkInOperationDto } from './mobile-walk-in.dto';
import { assignmentAuthorizationRequired } from '../operations/recurring-authorization';

/**
 * O atendimento avulso, numa transação.
 *
 * Cliente, equipamentos e ordem nascem juntos ou não nascem: o técnico está na
 * porta, e um cliente cadastrado sem a ordem o deixaria sem saber o que já
 * aconteceu — com a tentação de cadastrar de novo.
 *
 * A ordem é criada por `OperationRepository.createWithin`, que é a fronteira
 * por onde **toda** ordem de serviço nasce: ela reserva o número da OS, grava a
 * participação, o histórico e emite `operation.created`. Criar a operação aqui
 * à mão produziria uma ordem fora da contagem, invisível para o relatório de
 * equipe e para as automações.
 */
@Injectable()
export class MobileWalkInRepository {
  constructor(
    private readonly rls: RlsTransaction,
    private readonly operations: OperationRepository,
  ) {}

  /** A unidade do ator, para quando o comando não escolhe uma. */
  primaryUnit(organizationId: string, unitIds: readonly string[]) {
    return this.rls.run((tx) =>
      tx.businessUnit.findFirst({
        where: {
          organizationId,
          id: { in: [...unitIds] },
          status: 'ACTIVE',
          deletedAt: null,
        },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        select: { id: true },
      }),
    );
  }

  /** Os clientes que já estão na carteira, para o primeiro passo escolher. */
  customers(organizationId: string, search: string | undefined, limit: number) {
    const termo = search?.trim();
    return this.rls.run((tx) =>
      tx.customer.findMany({
        where: {
          organizationId,
          status: 'ACTIVE',
          deletedAt: null,
          ...(termo
            ? {
                OR: [
                  { legalName: { contains: termo, mode: 'insensitive' } },
                  { tradeName: { contains: termo, mode: 'insensitive' } },
                  { documentNumber: { contains: termo.replace(/\D/g, '') } },
                ],
              }
            : {}),
        },
        orderBy: [{ legalName: 'asc' }],
        take: limit,
        select: {
          id: true,
          type: true,
          legalName: true,
          tradeName: true,
          documentNumber: true,
          phone: true,
          email: true,
          address: true,
          addresses: {
            where: { deletedAt: null },
            orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
            take: 5,
            select: {
              id: true,
              label: true,
              street: true,
              number: true,
              complement: true,
              district: true,
              city: true,
              stateCode: true,
              postalCode: true,
              /* O ponto de referência vive em `notes`: é o que localiza em
                 campo — portaria, portão, instruções de acesso. */
              notes: true,
            },
          },
        },
      }),
    );
  }

  /** Os equipamentos de um cliente, para o passo de escolha. */
  customerAssets(
    organizationId: string,
    customerId: string,
    unitIds: readonly string[],
  ) {
    return this.rls.run((tx) =>
      tx.asset.findMany({
        where: {
          organizationId,
          customerId,
          businessUnitId: { in: [...unitIds] },
          deletedAt: null,
          status: 'ACTIVE',
        },
        orderBy: [{ location: 'asc' }, { name: 'asc' }],
        take: 100,
        select: {
          id: true,
          name: true,
          category: true,
          manufacturer: true,
          model: true,
          serialNumber: true,
          identifier: true,
          location: true,
        },
      }),
    );
  }

  /**
   * Abre o atendimento avulso.
   *
   * `idempotencyKey` é consultada **dentro** da transação, atrás de um lock por
   * chave: dois toques no mesmo botão, ou um reenvio automático, encontram o
   * comando já registrado e recebem a mesma ordem em vez de abrirem a segunda.
   */
  create(input: {
    organizationId: string;
    businessUnitId: string;
    actorId: string;
    idempotencyKey: string;
    payloadHash: string;
    command: CreateWalkInOperationDto;
  }) {
    return this.rls.run(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`operation:walk-in:${input.organizationId}:${input.actorId}:${input.idempotencyKey}`}))`;
      const requiresAuthorization = await assignmentAuthorizationRequired(
        tx,
        input.organizationId,
      );

      const registrado = await tx.operationWalkInCommand.findUnique({
        where: {
          organizationId_actorId_idempotencyKey: {
            organizationId: input.organizationId,
            actorId: input.actorId,
            idempotencyKey: input.idempotencyKey,
          },
        },
        select: { operationId: true, payloadHash: true },
      });
      if (registrado) {
        if (registrado.payloadHash !== input.payloadHash)
          throw new Error('WALK_IN_IDEMPOTENCY_PAYLOAD_MISMATCH');
        const operation = requiresAuthorization
          ? await tx.operation.findFirst({
              where: {
                id: registrado.operationId,
                organizationId: input.organizationId,
                businessUnitId: input.businessUnitId,
                deletedAt: null,
              },
              select: { authorizedAt: true },
            })
          : null;
        return {
          operationId: registrado.operationId,
          created: false,
          awaitingAuthorization:
            requiresAuthorization && !operation?.authorizedAt,
        };
      }

      const unit = await tx.businessUnit.findFirst({
        where: {
          id: input.businessUnitId,
          organizationId: input.organizationId,
          status: 'ACTIVE',
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!unit) throw new Error('BUSINESS_UNIT_SCOPE_INVALID');

      const customerId = await this.resolveCustomer(tx, input);
      const assetIds = await this.resolveAssets(tx, input, customerId);
      const endereco = await this.resolveAddress(tx, input, customerId);

      const nome = await tx.customer.findFirst({
        where: { id: customerId },
        select: { legalName: true, tradeName: true },
      });
      const titulo =
        input.command.title?.trim() ||
        `Atendimento avulso — ${nome?.tradeName ?? nome?.legalName ?? 'cliente'}`;

      const operation = await this.operations.createWithin(
        tx,
        {
          organizationId: input.organizationId,
          businessUnitId: input.businessUnitId,
          customerId,
          customerAddressId: endereco?.id ?? null,
          sector: input.command.sector ?? null,
          /* O código carrega a origem: quem olha a lista no escritório vê de
             imediato que a ordem nasceu em campo, sem abrir. */
          code: `AVULSO-${generateUuidV7()}`,
          kind: input.command.kind ?? 'MAINTENANCE',
          title: titulo.slice(0, 220),
          description: input.command.description ?? null,
          status: 'OPEN',
          priority: input.command.priority ?? 'NORMAL',
          /**
           * Quem abre é quem executa.
           *
           * O comando existe porque a pessoa está no local; atribuir a outro
           * seria abrir trabalho para terceiro a partir da porta do cliente.
           * Reatribuir depois é decisão do escritório, pela tela de operações.
           */
          responsibleFieldTechnicianId: input.actorId,
          authorizedAt: requiresAuthorization ? null : new Date(),
          authorizedById: requiresAuthorization ? null : input.actorId,
          createdById: input.actorId,
          location: endereco
            ? Prisma.JsonNull
            : this.json(input.command.customer?.address),
          data: this.json({ source: 'MOBILE_WALK_IN' }),
        },
        input.actorId,
        { source: 'MOBILE_WALK_IN', assetCount: assetIds.length },
        [],
        assetIds,
      );

      await tx.operationWalkInCommand.create({
        data: {
          id: generateUuidV7(),
          organizationId: input.organizationId,
          businessUnitId: input.businessUnitId,
          actorId: input.actorId,
          idempotencyKey: input.idempotencyKey,
          payloadHash: input.payloadHash,
          operationId: operation.id,
          customerId,
          createdAssetCount: input.command.equipment?.length ?? 0,
        },
      });

      return {
        operationId: operation.id,
        created: true,
        awaitingAuthorization: requiresAuthorization,
      };
    });
  }

  /** O cliente escolhido, ou o cadastrado na hora. */
  private async resolveCustomer(
    tx: Prisma.TransactionClient,
    input: {
      organizationId: string;
      businessUnitId: string;
      actorId: string;
      command: CreateWalkInOperationDto;
    },
  ): Promise<string> {
    const escolhido = input.command.customerId;
    if (escolhido) {
      const existente = await tx.customer.findFirst({
        where: {
          id: escolhido,
          organizationId: input.organizationId,
          status: 'ACTIVE',
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!existente) throw new Error('WALK_IN_CUSTOMER_NOT_FOUND');
      return existente.id;
    }

    const novo = input.command.customer!;
    const digitos = novo.documentNumber?.replace(/\D/g, '') || null;
    const documentType = digitos
      ? (novo.type ?? 'COMPANY') === 'INDIVIDUAL'
        ? 'CPF'
        : 'CNPJ'
      : null;
    if (digitos) {
      const duplicate = await tx.customer.findFirst({
        where: {
          organizationId: input.organizationId,
          documentType,
          documentNumber: digitos,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (duplicate) throw new Error('WALK_IN_CUSTOMER_DOCUMENT_EXISTS');
    }
    const criado = await tx.customer.create({
      data: {
        organizationId: input.organizationId,
        type: novo.type ?? 'COMPANY',
        legalName: novo.legalName,
        tradeName: novo.tradeName ?? null,
        /* O tipo do documento segue o tipo do cliente, e não o comprimento do
           número: quem digitou 11 dígitos num cadastro de empresa errou o
           número, e inverter o cadastro escondria o erro. */
        documentType,
        documentNumber: digitos,
        email: novo.email?.toLowerCase() ?? null,
        phone: novo.phone ?? null,
        address: this.json(novo.address),
        status: 'ACTIVE',
        contacts: novo.contactName
          ? {
              create: {
                organizationId: input.organizationId,
                businessUnitId: input.businessUnitId,
                name: novo.contactName,
                email: novo.email?.toLowerCase() ?? null,
                phone: novo.phone ?? null,
                isPrimary: true,
              },
            }
          : undefined,
      },
      select: { id: true },
    });

    await tx.auditLog.create({
      data: {
        organizationId: input.organizationId,
        userId: input.actorId,
        action: 'WALK_IN_CUSTOMER_REGISTERED',
        entityType: 'CUSTOMER',
        entityId: criado.id,
        metadata: { command: 'MOBILE_WALK_IN' },
      },
    });

    return criado.id;
  }

  /** Os equipamentos escolhidos, mais os identificados na hora. */
  private async resolveAssets(
    tx: Prisma.TransactionClient,
    input: {
      organizationId: string;
      businessUnitId: string;
      command: CreateWalkInOperationDto;
    },
    customerId: string,
  ): Promise<string[]> {
    const pedidos = input.command.assetIds ?? [];
    const existentes = pedidos.length
      ? await tx.asset.findMany({
          where: {
            id: { in: pedidos },
            organizationId: input.organizationId,
            businessUnitId: input.businessUnitId,
            customerId,
            deletedAt: null,
          },
          select: { id: true },
        })
      : [];
    /* Equipamento de outro cliente ou de outra unidade não entra em silêncio:
       o atendimento sairia atrelado a um aparelho que não é daquele endereço. */
    if (existentes.length !== pedidos.length)
      throw new Error('WALK_IN_ASSET_SCOPE_INVALID');

    const criados: string[] = [];
    for (const equipamento of input.command.equipment ?? []) {
      const serialNumber = equipamento.serialNumber?.trim() || null;
      const identifier = equipamento.identifier?.trim() || null;
      if (serialNumber || identifier) {
        const duplicate = await tx.asset.findFirst({
          where: {
            organizationId: input.organizationId,
            deletedAt: null,
            OR: [
              ...(serialNumber ? [{ serialNumber }] : []),
              ...(identifier ? [{ identifier }] : []),
            ],
          },
          select: { serialNumber: true, identifier: true },
        });
        if (duplicate)
          throw new Error(
            identifier && duplicate.identifier === identifier
              ? 'WALK_IN_ASSET_IDENTIFIER_EXISTS'
              : 'WALK_IN_ASSET_SERIAL_EXISTS',
          );
      }
      const asset = await tx.asset.create({
        data: {
          organizationId: input.organizationId,
          businessUnitId: input.businessUnitId,
          customerId,
          /* `EQUIPMENT` por omissão: é o que um aparelho de climatização é, e
             a categoria é coluna obrigatória. */
          category: equipamento.category ?? 'EQUIPMENT',
          name: equipamento.name,
          manufacturer: equipamento.manufacturer ?? null,
          model: equipamento.model ?? null,
          serialNumber,
          location: equipamento.location ?? null,
          identifier,
          identifierType: identifier
            ? (equipamento.identifierType ?? 'INTERNAL_CODE')
            : null,
          installationAt: equipamento.installationAt,
          warrantyUntil: equipamento.warrantyUntil,
          specifications: equipamento.specifications
            ? this.json(equipamento.specifications)
            : undefined,
          status: 'ACTIVE',
        },
        select: { id: true },
      });
      criados.push(asset.id);
    }

    return [...existentes.map((item) => item.id), ...criados];
  }

  /**
   * O endereço de atendimento, quando dá para apontar um.
   *
   * Cliente existente costuma ter endereço cadastrado, e é a ele que a ordem
   * deve apontar — assim o técnico seguinte abre a rota sem redigitar. Cliente
   * novo com endereço informado ganha o primeiro `CustomerAddress`, que é o que
   * a aba Endereços lê.
   */
  private async resolveAddress(
    tx: Prisma.TransactionClient,
    input: {
      organizationId: string;
      command: CreateWalkInOperationDto;
    },
    customerId: string,
  ): Promise<{ id: string } | null> {
    if (input.command.customerId) {
      return tx.customerAddress.findFirst({
        where: { customerId, deletedAt: null },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        select: { id: true },
      });
    }

    const endereco = input.command.customer?.address;
    /* Sem rua e sem cidade não há endereço a cadastrar: uma linha com só o CEP
       apareceria na aba Endereços sem dizer onde é. */
    if (!endereco?.street || !endereco.city) return null;

    return tx.customerAddress.create({
      data: {
        organizationId: input.organizationId,
        customerId,
        label: 'Endereço de atendimento',
        street: endereco.street,
        number: endereco.number ?? null,
        complement: endereco.complement ?? null,
        district: endereco.district ?? null,
        city: endereco.city,
        stateCode: endereco.stateCode?.slice(0, 2) ?? null,
        postalCode: endereco.postalCode?.replace(/\D/g, '') || null,
        /* O ponto de referência é nota de acesso, e `notes` é a coluna que o
           documento e a tela de campo já leem como tal. */
        notes: endereco.reference ?? null,
        isPrimary: true,
      },
      select: { id: true },
    });
  }

  private json(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
    if (value === null || value === undefined) return Prisma.JsonNull;
    return value;
  }
}

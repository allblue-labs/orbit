import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  ConflictException,
  EntityNotFoundException,
  ForbiddenException,
  ValidationException,
} from '../../exceptions';
import type { MobileFieldActor } from './mobile-field.service';
import type { CreateWalkInOperationDto } from './mobile-walk-in.dto';
import { MobileWalkInRepository } from './mobile-walk-in.repository';

/**
 * Abrir um atendimento na hora, estando no local.
 *
 * ## Por que existe
 *
 * A fila de trabalho responde "o que me foi atribuído". Não respondia "estou na
 * porta de alguém que não tem ordem aberta" — e esse caso é metade do dia de
 * uma equipe de campo: o cliente liga, o técnico passa, o vizinho pede para
 * olhar o aparelho dele. Sem isto, o trabalho acontecia e não existia no
 * sistema: nenhuma OS, nenhum documento, nenhuma comissão.
 *
 * ## Exige rede, e a tela diz isso
 *
 * Diferente do resto do roteiro, este comando **não** é offline-first. Ele cria
 * cliente, equipamentos e ordem, e todos os três dependem de identificadores
 * que só o servidor emite. Fingir sucesso offline produziria um atendimento
 * local que, na sincronização, poderia colidir com um cadastro que outra pessoa
 * criou no escritório — e o técnico descobriria isso depois de executar.
 */
@Injectable()
export class MobileWalkInService {
  private readonly logger = new Logger(MobileWalkInService.name);

  constructor(private readonly repository: MobileWalkInRepository) {}

  /** A carteira, para o passo de escolher um cliente existente. */
  async customers(actor: MobileFieldActor, search?: string, limit = 25) {
    this.requirePermission(actor, 'customers.read');
    const rows = await this.repository.customers(
      actor.organizationId,
      search,
      Math.min(Math.max(limit, 1), 50),
    );
    return {
      items: rows.map((row) => ({
        id: row.id,
        type: row.type,
        legalName: row.legalName,
        tradeName: row.tradeName,
        documentNumber: row.documentNumber,
        phone: row.phone,
        email: row.email,
        addresses: row.addresses.map((address) => ({
          id: address.id,
          label: address.label,
          street: address.street,
          number: address.number,
          complement: address.complement,
          district: address.district,
          city: address.city,
          stateCode: address.stateCode,
          postalCode: address.postalCode,
          reference: address.notes,
        })),
      })),
    };
  }

  /** Os equipamentos daquele cliente, para o técnico marcar os que vai atender. */
  async customerAssets(
    actor: MobileFieldActor,
    customerId: string,
    businessUnitId?: string,
  ) {
    this.requirePermission(actor, 'customers.read');
    if (businessUnitId && !actor.businessUnitIds.includes(businessUnitId))
      throw new ForbiddenException('Organização fora do seu escopo');
    const rows = await this.repository.customerAssets(
      actor.organizationId,
      customerId,
      businessUnitId ? [businessUnitId] : actor.businessUnitIds,
    );
    return {
      items: rows.map((row) => ({
        id: row.id,
        name: row.name,
        category: row.category,
        manufacturer: row.manufacturer,
        model: row.model,
        serialNumber: row.serialNumber,
        identifier: row.identifier,
        location: row.location,
      })),
    };
  }

  async create(
    actor: MobileFieldActor,
    idempotencyKey: string | undefined,
    input: CreateWalkInOperationDto,
  ) {
    if (!idempotencyKey || !/^[A-Za-z0-9._:-]{8,160}$/.test(idempotencyKey))
      throw new ValidationException(
        'Idempotency-Key deve conter de 8 a 160 caracteres seguros',
      );
    this.requirePermission(actor, 'operations.create');

    /* Exatamente um dos dois: aceitar os dois obrigaria o servidor a escolher
       qual vale, e qualquer escolha seria arbitrária. */
    if (Boolean(input.customerId) === Boolean(input.customer))
      throw new ValidationException(
        'Informe um cliente existente ou os dados de um novo — não os dois',
      );
    if (input.customer && !input.customer.legalName?.trim())
      throw new ValidationException('O nome do cliente é obrigatório');

    const businessUnitId =
      input.businessUnitId ??
      (
        await this.repository.primaryUnit(
          actor.organizationId,
          actor.businessUnitIds,
        )
      )?.id;
    if (!businessUnitId)
      throw new ForbiddenException('Nenhuma organização no seu escopo');
    if (!actor.businessUnitIds.includes(businessUnitId))
      throw new ForbiddenException('Organização fora do seu escopo');

    try {
      const result = await this.repository.create({
        organizationId: actor.organizationId,
        businessUnitId,
        actorId: actor.id,
        idempotencyKey,
        payloadHash: this.hash({ ...input, businessUnitId }),
        command: input,
      });
      this.logger.log(
        JSON.stringify({
          metric: 'mobile_walk_in_created_total',
          created: result.created,
          withNewCustomer: Boolean(input.customer),
          newAssets: input.equipment?.length ?? 0,
        }),
      );
      return {
        operationId: result.operationId,
        idempotency: { key: idempotencyKey, replayed: !result.created },
      };
    } catch (error) {
      throw this.translate(error);
    }
  }

  /**
   * Os erros da transação, em recusas de contrato.
   *
   * A transação sinaliza com `Error` de mensagem conhecida porque ela não deve
   * conhecer HTTP. Traduzir aqui mantém a camada de baixo ignorante do
   * transporte e evita que uma condição de domínio chegue ao cliente como 500.
   */
  private translate(error: unknown): unknown {
    if (!(error instanceof Error)) return error;
    switch (error.message) {
      case 'WALK_IN_IDEMPOTENCY_PAYLOAD_MISMATCH':
        return new ConflictException(
          'Esta chave já foi usada com outros dados',
          'IDEMPOTENCY_MISMATCH',
        );
      case 'WALK_IN_CUSTOMER_NOT_FOUND':
        return new EntityNotFoundException('Cliente');
      case 'WALK_IN_ASSET_SCOPE_INVALID':
        return new ValidationException(
          'Algum equipamento não pertence a este cliente ou a esta organização',
        );
      case 'BUSINESS_UNIT_SCOPE_INVALID':
        return new ForbiddenException('Organização fora do seu escopo');
      default:
        return error;
    }
  }

  private requirePermission(actor: MobileFieldActor, permission: string): void {
    if (
      !actor.isOrganizationOwner &&
      !actor.permissions.includes('*') &&
      !actor.permissions.includes(permission)
    )
      throw new ForbiddenException(`Permissão ${permission} obrigatória`);
  }

  /** O payload canônico: chave repetida com outro conteúdo é defeito, não reenvio. */
  private hash(value: unknown): string {
    const normalize = (item: unknown): unknown => {
      if (item instanceof Date) return item.toISOString();
      if (Array.isArray(item)) return item.map(normalize);
      if (item && typeof item === 'object')
        return Object.fromEntries(
          Object.entries(item as Record<string, unknown>)
            .filter(([, entry]) => entry !== undefined)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, entry]) => [key, normalize(entry)]),
        );
      return item;
    };
    return createHash('sha256')
      .update(JSON.stringify(normalize(value)))
      .digest('hex');
  }
}

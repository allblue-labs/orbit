/**
 * Mapeadores do Commercial Engine.
 *
 * Nenhum modelo Prisma sai daqui. Dinheiro vira **string**, como no Financeiro
 * — é o mesmo `Decimal`, e o mesmo risco de perder centavo em ponto flutuante.
 *
 * Duas respostas são calculadas aqui, e as duas são do **servidor**: se a
 * proposta venceu, e o que se pode fazer com ela agora. Um navegador com a
 * data errada não decide se um orçamento ainda vale, e um cliente não
 * reimplementa a máquina de estados — publicá-la é o que evita duas interfaces
 * discordando sobre o que um orçamento aceita.
 */
import { Injectable } from '@nestjs/common';
import type {
  QuoteItemReadModel,
  QuoteReadModel,
  QuoteSummaryReadModel,
  QuoteTransitionsReadModel,
} from './quote.read-models';
import type { QuoteDetailRecord, QuoteRecord } from './quote.repository';

/** Aceita `Prisma.Decimal` sem importar o runtime do cliente gerado. */
type DecimalValue = { toString(): string } | number | string;

interface ItemRecord {
  id: string;
  kind: string;
  description: string;
  sku: string | null;
  unit: string;
  quantity: DecimalValue;
  unitPrice: DecimalValue;
  discount: DecimalValue;
  total: DecimalValue;
  notes: string | null;
  position: number;
  catalogItemId: string | null;
}

@Injectable()
export class QuoteMapper {
  detail(source: QuoteDetailRecord): QuoteReadModel {
    return {
      ...this.summary(source),
      items: source.items.map((item) => this.item(item)),
    };
  }

  summary(source: QuoteRecord): QuoteSummaryReadModel {
    const expired = this.expired(source.validUntil);

    return {
      id: source.id,
      number: source.number,
      code: source.code,
      status: source.status,
      title: source.title,
      notes: source.notes,
      introText: source.introText,
      validUntil: source.validUntil ? this.day(source.validUntil) : null,
      isExpired: expired,
      currency: source.currency,
      subtotal: this.money(source.subtotal),
      discount: this.money(source.discount),
      discountReason: source.discountReason,
      total: this.money(source.total),
      customer: {
        id: source.customer.id,
        displayName: source.customer.tradeName ?? source.customer.legalName,
      },
      businessUnit: {
        id: source.businessUnit.id,
        name: source.businessUnit.tradeName ?? source.businessUnit.legalName,
      },
      serviceAddress: source.serviceAddress
        ? {
            id: source.serviceAddress.id,
            label: source.serviceAddress.label,
            summary: this.addressSummary(source.serviceAddress),
          }
        : null,
      responsible: source.responsible
        ? {
            id: source.responsible.id,
            displayName: source.responsible.displayName,
          }
        : null,
      /* Sem fotografia: o cadastro do equipamento é a fonte viva, e renomear o
         aparelho deve mudar o que a proposta mostra. */
      assets: source.assets.map(({ asset }) => ({
        id: asset.id,
        name: asset.name,
        identifier: asset.identifier,
        location: asset.location,
      })),
      itemCount: source._count.items,
      transitions: this.transitions(source, expired),
      operation: source.operation
        ? {
            id: source.operation.id,
            code: source.operation.code,
            title: source.operation.title,
          }
        : null,
      convertedAt: source.convertedAt?.toISOString() ?? null,
      sentAt: source.sentAt?.toISOString() ?? null,
      sentBy: source.sentBy
        ? { id: source.sentBy.id, displayName: source.sentBy.displayName }
        : null,
      decidedAt: source.decidedAt?.toISOString() ?? null,
      decidedBy: source.decidedBy
        ? { id: source.decidedBy.id, displayName: source.decidedBy.displayName }
        : null,
      closingReason: source.closingReason,
      expiredAt: source.expiredAt?.toISOString() ?? null,
      cancelledAt: source.cancelledAt?.toISOString() ?? null,
      createdBy: {
        id: source.createdBy.id,
        displayName: source.createdBy.displayName,
      },
      createdAt: source.createdAt.toISOString(),
      updatedAt: source.updatedAt.toISOString(),
    };
  }

  /**
   * O endereço em uma linha.
   *
   * Montado no servidor, e a mesma linha que vai no documento: se cada cliente
   * montasse a sua, a proposta na tela e a proposta impressa descreveriam o
   * mesmo lugar de formas diferentes.
   */
  private addressSummary(source: {
    label: string;
    street: string;
    number: string | null;
    complement: string | null;
    district: string | null;
    city: string;
    stateCode: string | null;
  }): string {
    const logradouro = [source.street, source.number]
      .filter(Boolean)
      .join(', ');
    const cidade = [source.city, source.stateCode].filter(Boolean).join('/');
    return [
      source.label,
      logradouro,
      source.complement,
      source.district,
      cidade,
    ]
      .filter((parte) => parte && String(parte).length > 0)
      .join(' — ');
  }

  item(source: ItemRecord): QuoteItemReadModel {
    return {
      id: source.id,
      kind: source.kind,
      description: source.description,
      sku: source.sku,
      unit: source.unit,
      quantity: this.money(source.quantity, 3),
      unitPrice: this.money(source.unitPrice),
      discount: this.money(source.discount),
      total: this.money(source.total),
      notes: source.notes,
      position: source.position,
      catalogItemId: source.catalogItemId,
    };
  }

  /**
   * O que a proposta aceita agora.
   *
   * Espelha `TRANSITIONS` do serviço, e não o substitui: quem recusa continua
   * sendo o servidor, na requisição. Aqui é descrição, para que a interface
   * não ofereça o que seria negado — e `canSend` inclui as pré-condições de
   * conteúdo, porque um rascunho vazio não pode ser enviado por mais que o
   * estado permita.
   */
  private transitions(
    source: QuoteRecord,
    expired: boolean,
  ): QuoteTransitionsReadModel {
    const status = source.status;
    const draft = status === 'DRAFT';
    const sent = status === 'SENT' && !expired;

    return {
      canEdit: draft,
      canSend:
        draft &&
        source._count.items > 0 &&
        Number(source.total) > 0 &&
        source.validUntil !== null &&
        !expired,
      canApprove: sent,
      canReject: sent,
      canCancel: draft || sent || status === 'APPROVED',
      canConvert: status === 'APPROVED' && source.operation === null,
    };
  }

  /**
   * Venceu?
   *
   * `valid_until` é `DATE`: a proposta vale **até o fim** do dia marcado. A
   * comparação é feita em UTC contra o dia corrente do servidor, a mesma
   * fronteira que a instrução de expiração usa no banco.
   */
  private expired(validUntil: Date | null): boolean {
    if (!validUntil) return false;
    const now = new Date();
    const today = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
    );
    return validUntil.getTime() < today;
  }

  private money(value: DecimalValue | null | undefined, places = 2): string {
    if (value === null || value === undefined) return (0).toFixed(places);
    const raw = typeof value === 'string' ? value : value.toString();
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed.toFixed(places) : raw;
  }

  private day(value: Date): string {
    return value.toISOString().slice(0, 10);
  }
}

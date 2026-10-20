/**
 * Regras do Commercial Engine.
 *
 * ## A máquina de estados mora aqui — e só aqui
 *
 * ```
 * DRAFT ──send──▶ SENT ──approve──▶ APPROVED ──cancel──▶ CANCELLED
 *   │               │  ├─reject───▶ REJECTED
 *   │               │  ├─expira───▶ EXPIRED      (servidor, por validade)
 *   └──cancel───────┴──cancel────▶ CANCELLED
 * ```
 *
 * `REJECTED`, `EXPIRED` e `CANCELLED` são terminais. Não há endpoint genérico
 * de troca de status: cada transição tem nome de negócio, porque "enviar",
 * "aprovar" e "cancelar" registram coisas diferentes — quem enviou, quem
 * decidiu, por quê. Um `PATCH { status }` apagaria essa distinção e permitiria
 * pular de rascunho para aprovado sem que ninguém tivesse proposto nada.
 *
 * ## Conversão não é estado
 *
 * Ter virado operação é `operationId` preenchido. Um orçamento convertido
 * continua `APPROVED`: o que mudou não foi a proposta, foi a existência de
 * trabalho por causa dela.
 *
 * ## O que este domínio não faz
 *
 * Não emite nota, não cobra, não parcela, não calcula imposto nem comissão,
 * não move estoque e não mantém funil de vendas. Propõe um valor e registra a
 * resposta.
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  STORAGE_PROVIDER,
  type StorageProvider,
} from '../storage/storage.types';
import { Prisma } from '@prisma/client';
import {
  ConflictException,
  EntityNotFoundException,
  ValidationException,
} from '../../exceptions';
import { QuoteStatus } from '../../contracts';
import type {
  AddQuoteItemDto,
  CancelQuoteDto,
  ConvertQuoteDto,
  CreateQuoteDto,
  CreateQuoteFromOperationDto,
  QuoteQueryDto,
  RejectQuoteDto,
  UpdateQuoteDto,
  UpdateQuoteItemDto,
} from './quote.dto';
import {
  QuoteRepository,
  type ItemSnapshot,
  type QuoteDetailRecord,
} from './quote.repository';
import { QuoteDocumentService } from '../artifact-rendering/quote-document.service';
import { readEmbeddedImage } from '../../common/embedded-image';
import { issuerLogo, type BrandedIssuer } from '../../common/issuer-brand';

/** Moedas aceitas — as mesmas do Financeiro, que é onde o valor termina. */
const SUPPORTED_CURRENCIES: readonly string[] = ['BRL', 'USD', 'EUR'];

/**
 * De onde cada transição pode partir.
 *
 * Tabela em vez de `if` espalhado: é a definição autoritativa da máquina, e
 * uma linha a mais aqui é toda a mudança quando um estado novo aparecer.
 */
const TRANSITIONS = {
  send: [QuoteStatus.DRAFT],
  approve: [QuoteStatus.SENT],
  reject: [QuoteStatus.SENT],
  cancel: [QuoteStatus.DRAFT, QuoteStatus.SENT, QuoteStatus.APPROVED],
} as const;

/** Só rascunho aceita edição de conteúdo — texto ou itens. */
const EDITABLE: readonly string[] = [QuoteStatus.DRAFT];

/* -------------------------------------------------------------------- */
/* Formatação do documento                                               */
/* -------------------------------------------------------------------- */

/** `Date` do Prisma (`@db.Date`) para `AAAA-MM-DD`, sem passar pelo fuso. */
function toDateOnlyString(valor: Date): string {
  return valor.toISOString().slice(0, 10);
}

function formatCivil(iso: string): string {
  const [ano, mes, dia] = iso.slice(0, 10).split('-');
  return dia && mes && ano ? `${dia}/${mes}/${ano}` : iso;
}

function dataSimples(valor: Date | null | undefined): string | undefined {
  return valor ? formatCivil(toDateOnlyString(valor)) : undefined;
}

/**
 * Quantos dias a proposta vale, contados da emissão.
 *
 * Sai ao lado da data porque "válido até 25/10/2026 (30 dias)" responde de uma
 * vez as duas perguntas que quem recebe faz. Prazo já vencido devolve
 * `undefined` — imprimir "(-3 dias)" numa proposta é constrangedor.
 */
function diasDeValidade(
  emissao: Date | null | undefined,
  validUntil: string | undefined,
): number | undefined {
  if (!emissao || !validUntil) return undefined;
  const de = Date.parse(`${toDateOnlyString(emissao)}T00:00:00Z`);
  const ate = Date.parse(`${validUntil}T00:00:00Z`);
  if (Number.isNaN(de) || Number.isNaN(ate)) return undefined;
  const dias = Math.round((ate - de) / 86_400_000);
  return dias > 0 ? dias : undefined;
}

/**
 * O timbre do emissor, quando há e quando é seguro imprimir.
 *
 * `issuerLogo` escolhe entre a marca da unidade e a da empresa;
 * `readEmbeddedImage` recusa URL — que o servidor teria de buscar, e o endereço
 * é escolhido pelo inquilino — e SVG, que carrega script.
 */
function logoDoEmissor(emissor: BrandedIssuer | null | undefined) {
  const imagem = readEmbeddedImage(issuerLogo(emissor));
  return imagem
    ? { logo: imagem.bytes, logoMimeType: imagem.mimeType }
    : undefined;
}

/** CNPJ e CPF com máscara; um documento comercial sem ela parece rascunho. */
function documentoFormatado(
  tipo: string | null | undefined,
  numero: string | null | undefined,
): string | undefined {
  if (!numero) return undefined;
  const digitos = numero.replace(/\D/g, '');
  if (digitos.length === 14) {
    return `CNPJ ${digitos.replace(
      /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
      '$1.$2.$3/$4-$5',
    )}`;
  }
  if (digitos.length === 11) {
    return `CPF ${digitos.replace(
      /^(\d{3})(\d{3})(\d{3})(\d{2})$/,
      '$1.$2.$3-$4',
    )}`;
  }
  return tipo ? `${tipo} ${numero}` : numero;
}

function enderecoCompleto(endereco: {
  label: string;
  street: string;
  number: string | null;
  complement: string | null;
  district: string | null;
  city: string;
  stateCode: string | null;
}): string {
  const logradouro = [endereco.street, endereco.number]
    .filter(Boolean)
    .join(', ');
  const cidade = [endereco.city, endereco.stateCode].filter(Boolean).join('/');
  return [
    endereco.label,
    logradouro,
    endereco.complement,
    endereco.district,
    cidade,
  ]
    .filter((parte) => parte && String(parte).length > 0)
    .join(' — ');
}

@Injectable()
export class QuoteService {
  constructor(
    private readonly repository: QuoteRepository,
    private readonly documents: QuoteDocumentService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  /* ---------------------------------------------------------------- */
  /* Leitura                                                           */
  /* ---------------------------------------------------------------- */

  async list(organizationId: string, query: QuoteQueryDto) {
    if (query.from && query.to && query.from > query.to) {
      throw new ValidationException('The period starts after it ends');
    }
    return this.repository.list(organizationId, query);
  }

  async get(id: string, organizationId: string): Promise<QuoteDetailRecord> {
    const quote = await this.repository.find(id, organizationId);
    if (!quote) throw new EntityNotFoundException('Quote', id);
    return quote;
  }

  /**
   * A proposta impressa.
   *
   * Desenhada na hora, a partir do estado atual. Não passa pela fila nem abre
   * revisão: um orçamento é editado enquanto é rascunho, e cada reimpressão
   * viraria versão de um documento que ninguém executou.
   *
   * Os valores saem como o domínio os persistiu. Recalcular na impressão
   * criaria uma segunda fonte de verdade sobre dinheiro.
   */
  async document(id: string, organizationId: string) {
    const fonte = await this.repository.documentSource(id, organizationId);
    if (!fonte) throw new EntityNotFoundException('Quote', id);

    const unidade = fonte.businessUnit;
    /* O endereço escolhido vence o principal do cliente. Imprimir
       `addresses[0]` para quem tem duas filiais era um chute com aparência de
       dado; o principal continua sendo o recurso das propostas que nasceram
       antes de haver escolha. */
    const endereco = fonte.serviceAddress ?? fonte.customer.addresses[0];
    const responsavel = await this.responsibleSignature(fonte.responsible);
    const validUntil = fonte.validUntil
      ? toDateOnlyString(fonte.validUntil)
      : undefined;

    const bytes = await this.documents.render({
      timezone: unidade?.timezone ?? 'America/Sao_Paulo',
      emitter: {
        ...logoDoEmissor(unidade),
        tradeName: unidade?.tradeName ?? undefined,
        legalName: unidade?.legalName ?? undefined,
        document: documentoFormatado(
          unidade?.documentType,
          unidade?.documentNumber,
        ),
        address: [unidade?.street, unidade?.number]
          .filter(Boolean)
          .join(', ')
          .concat(unidade?.district ? ` — ${unidade.district}` : ''),
        cityState: [unidade?.city, unidade?.stateCode]
          .filter(Boolean)
          .join('/'),
        phone: unidade?.phone ?? undefined,
        email: unidade?.email ?? undefined,
        website: unidade?.website ?? undefined,
      },
      quote: {
        quote: {
          code: fonte.code,
          title: fonte.title,
          status: fonte.status,
          issuedAt: dataSimples(fonte.sentAt ?? fonte.createdAt),
          validUntil: validUntil ? formatCivil(validUntil) : undefined,
          validityDays: diasDeValidade(
            fonte.sentAt ?? fonte.createdAt,
            validUntil,
          ),
          notes: fonte.notes ?? undefined,
          discountReason: fonte.discountReason ?? undefined,
          /* `?? undefined` e não `?? PADRÃO`: quem decide o padrão é o
             compositor, que é quem sabe o que imprime. String vazia atravessa,
             porque apagar o texto é escolha. */
          introText: fonte.introText ?? undefined,
          author: fonte.createdBy?.displayName ?? undefined,
          operationCode: fonte.operation?.code ?? undefined,
        },
        responsible: responsavel,
        assets: fonte.assets.map(({ asset }) => ({
          name: asset.name,
          identifier: asset.identifier ?? undefined,
          location: asset.location ?? undefined,
        })),
        customer: {
          name: fonte.customer.tradeName ?? fonte.customer.legalName,
          legalName: fonte.customer.tradeName
            ? fonte.customer.legalName
            : undefined,
          document: documentoFormatado(
            fonte.customer.documentType,
            fonte.customer.documentNumber,
          ),
          email: fonte.customer.email ?? undefined,
          phone: fonte.customer.phone ?? undefined,
          address: endereco ? enderecoCompleto(endereco) : undefined,
        },
        items: fonte.items.map((item) => ({
          kind: item.kind,
          description: item.description,
          sku: item.sku ?? undefined,
          unit: item.unit,
          quantity: Number(item.quantity),
          unitPrice: Number(item.unitPrice),
          discount: Number(item.discount),
          total: Number(item.total),
          notes: item.notes ?? undefined,
        })),
        totals: {
          subtotal: Number(fonte.subtotal),
          discount: Number(fonte.discount),
          total: Number(fonte.total),
        },
      },
    });

    return {
      bytes,
      mimeType: 'application/pdf',
      fileName: `${fonte.code}.pdf`,
    };
  }

  /**
   * O responsável, com a assinatura carregada quando existe.
   *
   * ## Assinatura ausente não impede imprimir
   *
   * Quem não cadastrou assinatura recebe a linha em branco para assinar à mão —
   * é o que o papel sempre permitiu, e recusar a emissão por isso deixaria a
   * proposta presa a uma configuração de perfil.
   *
   * ## Falha de leitura também não
   *
   * O objeto pode estar inacessível — bucket fora do ar, chave apagada à mão. A
   * proposta inteira não pode depender disso: sai com a linha em branco, que é
   * o mesmo resultado de quem nunca cadastrou.
   */
  private async responsibleSignature(
    responsible:
      | {
          displayName: string;
          professionalSignatures: readonly {
            storageObject: {
              bucket: string;
              objectKey: string;
              mimeType: string;
            };
          }[];
        }
      | null
      | undefined,
  ) {
    if (!responsible) return undefined;

    const assinatura = responsible.professionalSignatures[0];
    if (!assinatura) return { name: responsible.displayName };

    try {
      const bytes = await this.storage.get({
        bucket: assinatura.storageObject.bucket,
        objectKey: assinatura.storageObject.objectKey,
      });
      return {
        name: responsible.displayName,
        signatureImage: bytes,
        signatureImageMimeType: assinatura.storageObject.mimeType,
      };
    } catch {
      return { name: responsible.displayName };
    }
  }

  /* ---------------------------------------------------------------- */
  /* Criação e edição                                                  */
  /* ---------------------------------------------------------------- */

  /**
   * Confere endereço, equipamentos e responsável — os três vínculos que o
   * orçamento passou a ter.
   *
   * Uma função só, usada pela criação e pela edição: as regras são as mesmas, e
   * em duas cópias elas divergiriam na primeira vez que alguém mexesse numa.
   *
   * Cada recusa diz **qual** id falhou. "Algum equipamento é inválido" mandaria
   * a pessoa conferir cinquenta linhas para achar a errada.
   */
  private async validateScope(
    organizationId: string,
    customerId: string,
    input: {
      serviceAddressId?: string;
      assetIds?: readonly string[];
      responsibleUserId?: string;
    },
  ): Promise<void> {
    if (input.serviceAddressId) {
      const address = await this.repository.findCustomerAddress(
        input.serviceAddressId,
        organizationId,
        customerId,
      );
      if (!address) {
        throw new ValidationException(
          'O endereço informado não é um endereço cadastrado deste cliente.',
        );
      }
    }

    if (input.assetIds && input.assetIds.length > 0) {
      /* Duplicado no pedido seria recusado pelo índice único com erro de banco;
         aqui ele simplesmente não conta duas vezes. */
      const pedidos = [...new Set(input.assetIds)];
      const encontrados = await this.repository.findAssetIds(
        pedidos,
        organizationId,
      );
      const faltando = pedidos.filter((id) => !encontrados.includes(id));
      if (faltando.length > 0) {
        throw new ValidationException(
          `Equipamento não encontrado: ${faltando.join(', ')}`,
        );
      }
    }

    if (input.responsibleUserId) {
      const member = await this.repository.findMember(
        input.responsibleUserId,
        organizationId,
      );
      if (!member) {
        throw new ValidationException(
          'O responsável informado não é membro desta organização.',
        );
      }
    }
  }

  async create(
    organizationId: string,
    fallbackBusinessUnitId: string | null,
    actorId: string,
    input: CreateQuoteDto,
  ) {
    const businessUnitId = await this.resolveBusinessUnit(
      organizationId,
      input.businessUnitId ?? fallbackBusinessUnitId,
    );
    const customer = await this.repository.findCustomer(
      input.customerId,
      organizationId,
    );
    if (!customer) {
      throw new EntityNotFoundException('Customer', input.customerId);
    }

    const currency = input.currency ?? 'BRL';
    if (!SUPPORTED_CURRENCIES.includes(currency)) {
      throw new ValidationException('Unsupported currency');
    }
    this.requireFutureValidity(input.validUntil);
    await this.validateScope(organizationId, input.customerId, input);

    return this.repository.create({
      organizationId,
      businessUnitId,
      customerId: input.customerId,
      title: input.title,
      notes: input.notes ?? null,
      introText: input.introText ?? null,
      validUntil: input.validUntil ? this.dateOnly(input.validUntil) : null,
      currency,
      createdById: actorId,
      serviceAddressId: input.serviceAddressId ?? null,
      responsibleUserId: input.responsibleUserId ?? actorId,
      assetIds: input.assetIds,
    });
  }

  /**
   * A proposta copiada de um atendimento concluído.
   *
   * ## O que vem, e o que não vem
   *
   * Cliente, endereço, equipamentos, título e descrição vêm do atendimento. Os
   * **materiais** vêm dos movimentos de consumo — é a única origem de linha que
   * a operação oferece.
   *
   * **Serviço com valor não vem**, e a omissão é deliberada: `Operation` não
   * guarda linha de serviço com preço (`kind` é categoria, não item de
   * catálogo). Inventar uma linha de serviço aqui produziria valor numa proposta
   * que ninguém combinou — pior que campo vazio, porque teria aparência de dado.
   * Quem orça acrescenta os serviços no wizard.
   *
   * ## Só de concluído
   *
   * Copiar de um atendimento em andamento copiaria escopo que ainda vai mudar.
   *
   * ## Falha no meio não deixa rascunho pela metade
   *
   * A proposta é criada primeiro e os itens entram depois — cada um pelo mesmo
   * caminho de um item escolhido à mão, para que a fotografia e o recálculo
   * sejam os mesmos. Um material cujo item de catálogo foi desativado desde o
   * atendimento é **pulado**, não recusado: a proposta ainda é útil sem ele, e
   * derrubar a criação inteira por causa de um material obrigaria a pessoa a
   * começar do zero sem saber qual era.
   */
  async createFromOperation(
    organizationId: string,
    fallbackBusinessUnitId: string | null,
    actorId: string,
    input: CreateQuoteFromOperationDto,
  ) {
    const operation = await this.repository.findOperationSource(
      input.operationId,
      organizationId,
    );
    if (!operation) {
      throw new EntityNotFoundException('Operation', input.operationId);
    }
    if (operation.status !== 'COMPLETED') {
      throw new ValidationException(
        'Só um atendimento concluído pode virar orçamento — o escopo de um atendimento em andamento ainda vai mudar.',
      );
    }
    if (!operation.customerId) {
      throw new ValidationException(
        'O atendimento não tem cliente, e uma proposta precisa de destinatário.',
      );
    }

    this.requireFutureValidity(input.validUntil);
    await this.validateScope(organizationId, operation.customerId, {
      responsibleUserId: input.responsibleUserId,
    });

    const businessUnitId = await this.resolveBusinessUnit(
      organizationId,
      operation.businessUnitId ?? fallbackBusinessUnitId,
    );

    const quote = await this.repository.create({
      organizationId,
      businessUnitId,
      customerId: operation.customerId,
      title: input.title ?? `Orçamento — ${operation.title}`,
      notes: operation.description ?? null,
      introText: null,
      validUntil: input.validUntil ? this.dateOnly(input.validUntil) : null,
      currency: 'BRL',
      createdById: actorId,
      serviceAddressId: operation.customerAddressId,
      responsibleUserId: input.responsibleUserId ?? actorId,
      assetIds: operation.assets.map((link) => link.assetId),
    });

    const consumo = await this.repository.findOperationConsumption(
      input.operationId,
      organizationId,
    );

    let atual = quote;
    for (const linha of consumo) {
      try {
        const snapshot = await this.snapshot(organizationId, businessUnitId, {
          catalogItemId: linha.catalogItemId,
          quantity: Number(linha.quantity),
        });
        atual = await this.repository.addItem(
          quote.id,
          organizationId,
          businessUnitId,
          actorId,
          snapshot,
        );
      } catch {
        /* Item desativado ou sem preço de venda desde o atendimento. A proposta
           segue sem ele; quem orça vê a lista e completa o que faltar. */
      }
    }
    return atual;
  }

  async update(
    id: string,
    organizationId: string,
    actorId: string,
    input: UpdateQuoteDto,
  ) {
    const quote = await this.requireEditable(id, organizationId);
    if (input.validUntil) this.requireFutureValidity(input.validUntil);
    await this.validateScope(organizationId, quote.customer.id, input);

    /**
     * O desconto é conferido contra o subtotal atual.
     *
     * A constraint do banco também o faz, mas devolver 400 com explicação é
     * melhor que 500 com violação de constraint — e o `recalculate` apararia o
     * valor em silêncio, que seria pior ainda: o usuário pediria 500 de
     * desconto e veria 300 sem entender por quê.
     */
    if (input.discount !== undefined) {
      const subtotal = Number(quote.subtotal);
      if (input.discount > subtotal) {
        throw new ValidationException(
          `Discount exceeds the quote subtotal (${quote.subtotal.toString()})`,
        );
      }
    }

    return this.repository.update(
      id,
      organizationId,
      quote.businessUnit.id,
      actorId,
      {
        title: input.title,
        notes: input.notes,
        introText: input.introText,
        discountReason: input.discountReason,
        validUntil: input.validUntil
          ? this.dateOnly(input.validUntil)
          : undefined,
        serviceAddressId: input.serviceAddressId,
        responsibleUserId: input.responsibleUserId,
      },
      {
        title: quote.title,
        discount: quote.discount.toString(),
        validUntil: quote.validUntil?.toISOString() ?? null,
      },
      input.discount === undefined ? undefined : input.discount.toFixed(2),
      input.assetIds,
    );
  }

  /**
   * Remove um rascunho.
   *
   * Só `DRAFT`: proposta enviada não desaparece — ela é cancelada, e o motivo
   * fica. Apagar o que o cliente já viu destruiria a explicação de um negócio
   * perdido.
   */
  async remove(
    id: string,
    organizationId: string,
    actorId: string,
  ): Promise<void> {
    const quote = await this.requireEditable(id, organizationId);
    await this.repository.softDelete(
      id,
      organizationId,
      quote.businessUnit.id,
      actorId,
    );
  }

  /* ---------------------------------------------------------------- */
  /* Itens                                                             */
  /* ---------------------------------------------------------------- */

  /**
   * Acrescenta um item, congelando o que valia agora.
   *
   * Com `catalogItemId`, os campos ausentes vêm do Catálogo; os informados
   * sobrepõem, porque negociar preço é o que um orçamento faz. Sem ele,
   * descrição e preço passam a ser obrigatórios — é a regra que precisa ver os
   * dois campos juntos, e por isso mora aqui e não no DTO.
   */
  async addItem(
    quoteId: string,
    organizationId: string,
    actorId: string,
    input: AddQuoteItemDto,
  ) {
    const quote = await this.requireEditable(quoteId, organizationId);
    const snapshot = await this.snapshot(
      organizationId,
      quote.businessUnit.id,
      input,
    );
    return this.repository.addItem(
      quoteId,
      organizationId,
      quote.businessUnit.id,
      actorId,
      snapshot,
    );
  }

  async updateItem(
    quoteId: string,
    itemId: string,
    organizationId: string,
    actorId: string,
    input: UpdateQuoteItemDto,
  ) {
    const quote = await this.requireEditable(quoteId, organizationId);
    const item = await this.repository.findItem(itemId, quoteId);
    if (!item) throw new EntityNotFoundException('QuoteItem', itemId);

    return this.repository.updateItem(
      itemId,
      quoteId,
      organizationId,
      quote.businessUnit.id,
      actorId,
      {
        description: input.description,
        unit: input.unit,
        quantity:
          input.quantity === undefined ? undefined : input.quantity.toFixed(3),
        unitPrice:
          input.unitPrice === undefined
            ? undefined
            : input.unitPrice.toFixed(2),
        discount:
          input.discount === undefined ? undefined : input.discount.toFixed(2),
        notes: input.notes,
      },
      {
        description: item.description,
        quantity: item.quantity.toString(),
        unitPrice: item.unitPrice.toString(),
        total: item.total.toString(),
      },
    );
  }

  async removeItem(
    quoteId: string,
    itemId: string,
    organizationId: string,
    actorId: string,
  ) {
    const quote = await this.requireEditable(quoteId, organizationId);
    const item = await this.repository.findItem(itemId, quoteId);
    if (!item) throw new EntityNotFoundException('QuoteItem', itemId);

    return this.repository.removeItem(
      itemId,
      quoteId,
      organizationId,
      quote.businessUnit.id,
      actorId,
      { description: item.description, total: item.total.toString() },
    );
  }

  /* ---------------------------------------------------------------- */
  /* Transições                                                        */
  /* ---------------------------------------------------------------- */

  /**
   * Envia a proposta ao cliente.
   *
   * Exige ao menos um item e um total maior que zero: enviar um orçamento
   * vazio ou de R$ 0,00 é enviar um documento que não propõe nada, e o cliente
   * não teria o que aprovar.
   *
   * Exige validade: uma proposta sem prazo é uma proposta que nunca expira, e
   * o preço de hoje passa a valer para sempre.
   */
  async send(id: string, organizationId: string, actorId: string) {
    const quote = await this.requireStatus(
      id,
      organizationId,
      TRANSITIONS.send,
    );

    if (quote._count.items === 0) {
      throw new ConflictException('A quote without items cannot be sent');
    }
    if (Number(quote.total) <= 0) {
      throw new ConflictException('A quote with no value cannot be sent');
    }
    if (!quote.validUntil) {
      throw new ConflictException(
        'A quote must have a validity date before it is sent',
      );
    }
    this.requireFutureValidity(quote.validUntil);

    return this.applied(
      await this.repository.transition({
        id,
        organizationId,
        businessUnitId: quote.businessUnit.id,
        actorId,
        from: TRANSITIONS.send,
        to: QuoteStatus.SENT,
        data: { sentAt: new Date(), sentById: actorId },
        action: 'QUOTE_SENT',
        details: { total: quote.total.toString() },
      }),
    );
  }

  /**
   * Aprovação do cliente.
   *
   * Dispara o evento que cria a **receita prevista** — nunca realizada: o
   * trabalho ainda não foi feito e o dinheiro não entrou. Confirmar é ato do
   * Financeiro, quando o pagamento acontecer.
   */
  async approve(id: string, organizationId: string, actorId: string) {
    const quote = await this.requireStatus(
      id,
      organizationId,
      TRANSITIONS.approve,
    );

    return this.applied(
      await this.repository.transition({
        id,
        organizationId,
        businessUnitId: quote.businessUnit.id,
        actorId,
        from: TRANSITIONS.approve,
        to: QuoteStatus.APPROVED,
        data: { decidedAt: new Date(), decidedById: actorId },
        action: 'QUOTE_APPROVED',
        details: { total: quote.total.toString() },
        event: true,
      }),
    );
  }

  async reject(
    id: string,
    organizationId: string,
    actorId: string,
    input: RejectQuoteDto,
  ) {
    const quote = await this.requireStatus(
      id,
      organizationId,
      TRANSITIONS.reject,
    );

    return this.applied(
      await this.repository.transition({
        id,
        organizationId,
        businessUnitId: quote.businessUnit.id,
        actorId,
        from: TRANSITIONS.reject,
        to: QuoteStatus.REJECTED,
        data: {
          decidedAt: new Date(),
          decidedById: actorId,
          closingReason: input.reason,
        },
        action: 'QUOTE_REJECTED',
        details: { reason: input.reason },
      }),
    );
  }

  /**
   * Cancela — inclusive depois de aprovado.
   *
   * O evento cancela a receita prevista correspondente, se houver, **sem
   * apagá-la**: a previsão existiu e alguém a viu no relatório. A operação já
   * criada por uma conversão **não é tocada**: se há trabalho em campo, quem
   * decide encerrá-lo é o domínio de operações, e desfazê-lo daqui apagaria
   * histórico de execução por causa de uma decisão comercial.
   */
  async cancel(
    id: string,
    organizationId: string,
    actorId: string,
    input: CancelQuoteDto,
  ) {
    const quote = await this.requireStatus(
      id,
      organizationId,
      TRANSITIONS.cancel,
    );

    return this.applied(
      await this.repository.transition({
        id,
        organizationId,
        businessUnitId: quote.businessUnit.id,
        actorId,
        from: TRANSITIONS.cancel,
        to: QuoteStatus.CANCELLED,
        data: { cancelledAt: new Date(), closingReason: input.reason },
        action: 'QUOTE_CANCELLED',
        details: { reason: input.reason },
        event: true,
      }),
    );
  }

  /* ---------------------------------------------------------------- */
  /* Conversão                                                         */
  /* ---------------------------------------------------------------- */

  /**
   * Transforma a proposta aprovada em trabalho.
   *
   * Só de `APPROVED`: converter um rascunho seria abrir ordem de serviço para
   * algo que ninguém contratou. Só uma vez: `operationId` guarda o resultado, e
   * repetir devolve a operação existente em vez de criar a segunda.
   *
   * **Nada é inventado.** Técnico, execução, checklist e agenda não são
   * atribuídos: o contrato de `Operation` os trata como decisões posteriores, e
   * escolhê-los aqui produziria uma ordem de serviço que ninguém combinou. O
   * que a conversão sabe é quem é o cliente, qual a unidade e o que foi
   * proposto.
   */
  async convert(
    id: string,
    organizationId: string,
    actorId: string,
    input: ConvertQuoteDto,
  ) {
    const quote = await this.get(id, organizationId);

    /** Já convertido: devolve o mesmo, sem criar nada. */
    if (quote.operationId) return quote;

    if (quote.status !== QuoteStatus.APPROVED) {
      throw new ConflictException(
        `Only an approved quote can become an operation (current: ${quote.status})`,
      );
    }
    if (input.scheduledStart && input.scheduledEnd) {
      if (input.scheduledEnd < input.scheduledStart) {
        throw new ValidationException(
          'Scheduled end cannot precede scheduled start',
        );
      }
    }

    const code = await this.operationCode(organizationId, quote.code);

    const converted = await this.repository.convert({
      quoteId: id,
      organizationId,
      businessUnitId: quote.businessUnit.id,
      customerId: quote.customer.id,
      actorId,
      code,
      kind: input.kind ?? 'MAINTENANCE',
      priority: input.priority ?? 'NORMAL',
      title: quote.title,
      description: `Originado do orçamento ${quote.code}.`,
      scheduledStart: input.scheduledStart ?? null,
      scheduledEnd: input.scheduledEnd ?? null,
    });

    /**
     * Perdeu a corrida: outra requisição converteu primeiro, e a operação
     * criada por esta desapareceu no rollback. O resultado correto é o que já
     * existe.
     */
    if (!converted) return this.get(id, organizationId);
    return converted;
  }

  /* ---------------------------------------------------------------- */
  /* Internos                                                          */
  /* ---------------------------------------------------------------- */

  /**
   * Congela o item.
   *
   * O preço do Catálogo é **sugestão inicial**, não vínculo: uma vez gravado,
   * o item não olha mais para lá. É o que permite mudar a tabela de preços sem
   * reescrever propostas já enviadas — e o que impede alguém de descobrir, seis
   * meses depois, que um orçamento antigo mudou de valor sozinho.
   */
  private async snapshot(
    organizationId: string,
    businessUnitId: string,
    input: AddQuoteItemDto,
  ): Promise<ItemSnapshot> {
    const quantity = input.quantity.toFixed(3);
    const discount = (input.discount ?? 0).toFixed(2);

    if (!input.catalogItemId) {
      if (!input.description || input.unitPrice === undefined) {
        throw new ValidationException(
          'An item without a catalog reference needs description and unitPrice',
        );
      }
      return {
        catalogItemId: null,
        kind: 'SERVICE',
        description: input.description,
        sku: null,
        unit: input.unit ?? 'UN',
        quantity,
        unitPrice: input.unitPrice.toFixed(2),
        discount,
        notes: input.notes ?? null,
      };
    }

    const product = await this.repository.findCatalogItem(
      input.catalogItemId,
      organizationId,
      businessUnitId,
    );
    if (!product) {
      throw new EntityNotFoundException('CatalogItem', input.catalogItemId);
    }
    if (product.status !== 'ACTIVE') {
      throw new ConflictException(
        'This catalog item is no longer offered and cannot be quoted',
      );
    }

    const price = input.unitPrice ?? this.decimal(product.salePrice);
    if (price === null) {
      throw new ValidationException(
        'The catalog item has no sale price; inform unitPrice explicitly',
      );
    }

    return {
      catalogItemId: product.id,
      kind: product.kind,
      description: input.description ?? product.name,
      sku: product.sku,
      unit: input.unit ?? product.unit,
      quantity,
      unitPrice: price.toFixed(2),
      discount,
      notes: input.notes ?? null,
    };
  }

  /**
   * Código da operação derivada.
   *
   * Deriva do código do orçamento — `ORC-000042` vira `OS-ORC-000042` — para
   * que a origem seja legível na listagem de operações sem abrir nada. Se
   * estiver ocupado, um sufixo curto resolve; o índice único do banco continua
   * sendo a autoridade.
   */
  private async operationCode(
    organizationId: string,
    quoteCode: string,
  ): Promise<string> {
    const seed = `OS-${quoteCode}`;
    const free = await this.repository.nextOperationCode(organizationId, seed);
    if (free) return free;
    return `${seed}-${Date.now().toString(36).slice(-4).toUpperCase()}`;
  }

  private async requireEditable(id: string, organizationId: string) {
    const quote = await this.get(id, organizationId);
    if (!EDITABLE.includes(quote.status)) {
      throw new ConflictException(
        `Only a draft quote can be changed (current: ${quote.status})`,
      );
    }
    return quote;
  }

  /**
   * Confere o estado de partida **depois** de expirar o que venceu.
   *
   * A ordem importa: sem expirar antes, uma proposta vencida ainda apareceria
   * como `SENT` e aceitaria aprovação — o cliente aprovaria um preço que já não
   * vale.
   */
  private async requireStatus(
    id: string,
    organizationId: string,
    allowed: readonly string[],
  ) {
    await this.repository.expire(organizationId);
    const quote = await this.get(id, organizationId);
    if (!allowed.includes(quote.status)) {
      throw new ConflictException(
        `This quote is ${quote.status} and cannot make that transition`,
      );
    }
    return quote;
  }

  /**
   * `null` significa que outra requisição mudou o estado no meio do caminho.
   *
   * A verificação anterior passou, a escrita condicional não — é a corrida de
   * dois cliques. Recusar é o certo: o segundo clique não deve sobrescrever
   * quem decidiu e quando.
   */
  private applied(quote: QuoteDetailRecord | null): QuoteDetailRecord {
    if (!quote) {
      throw new ConflictException(
        'The quote changed while this request was being processed',
      );
    }
    return quote;
  }

  private async resolveBusinessUnit(
    organizationId: string,
    candidate: string | null | undefined,
  ): Promise<string> {
    if (!candidate) {
      throw new ValidationException('A business unit is required');
    }
    const unit = await this.repository.findBusinessUnit(
      candidate,
      organizationId,
    );
    if (!unit) throw new EntityNotFoundException('BusinessUnit', candidate);
    return unit.id;
  }

  /** Validade no passado é proposta nascida vencida. */
  private requireFutureValidity(value: Date | null | undefined): void {
    if (!value) return;
    const day = this.dateOnly(value);
    const today = this.dateOnly(new Date());
    if (day < today) {
      throw new ValidationException('Validity date is in the past');
    }
  }

  /** Meia-noite UTC: a coluna é `DATE`, e hora só criaria diferença por fuso. */
  private dateOnly(value: Date): Date {
    return new Date(
      Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
    );
  }

  private decimal(value: Prisma.Decimal | null): number | null {
    if (value === null) return null;
    const parsed = Number(value.toString());
    return Number.isFinite(parsed) ? parsed : null;
  }
}

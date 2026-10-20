/**
 * Emitir o documento de um orçamento.
 *
 * ## Baixar e emitir deixam de ser a mesma coisa
 *
 * `GET /quotes/:id/document` renderiza um PDF na hora e o devolve pela conexão:
 * sem código de documento, sem revisão, sem hash, sem arquivo guardado. Serve
 * para conferir antes de mandar, e por isso não deixa rastro — conferir não pode
 * consumir número de documento.
 *
 * O que faltava era o outro ato. A proposta que o cliente aprovou não era
 * recuperável: existia a proposta **atual**, que pode ter mudado depois, e nenhum
 * registro do papel que foi enviado. E nada disso aparecia na central de
 * documentos emitidos, porque não havia o que listar.
 *
 * Emitir passa a ser o que já é para o recibo: uma execução do tipo `ORCAMENTO`
 * com as respostas preenchidas a partir da proposta.
 *
 * ## O que esta porta não faz
 *
 * Não publica o manifesto. O modelo oficial exige a assinatura do proponente, e
 * assinar é ato de pessoa — fazê-lo aqui seria o servidor assinando em nome de
 * alguém. A execução nasce preenchida e o resto acontece na tela dela: assinar e
 * emitir. É o mesmo caminho do recibo, e é por isso que a resposta é a execução:
 * a tela leva quem emitiu até lá.
 */
import { Injectable, Logger } from '@nestjs/common';
import { RlsTransaction } from '../../database';
import { ConflictException, EntityNotFoundException } from '../../exceptions';
import { ArtifactExecutionService } from '../artifact-executions/artifact-execution.service';
import type { ArtifactExecutionReadModel } from '../artifact-executions/artifact-execution.read-models';
import { QuoteRepository } from './quote.repository';
import { quoteAnswers, type QuoteEmissionSource } from './quote-emission';

/** O tipo de artefato do documento de proposta, no catálogo oficial. */
export const QUOTE_ARTIFACT_TYPE = 'ORCAMENTO';

@Injectable()
export class QuoteEmissionService {
  private readonly logger = new Logger(QuoteEmissionService.name);

  constructor(
    private readonly rls: RlsTransaction,
    private readonly repository: QuoteRepository,
    private readonly executions: ArtifactExecutionService,
  ) {}

  async issue(
    quoteId: string,
    organizationId: string,
    actorId: string,
  ): Promise<ArtifactExecutionReadModel> {
    const quote = await this.repository.emissionSource(quoteId, organizationId);
    if (!quote) throw new EntityNotFoundException('Quote', quoteId);

    /*
     * Rascunho não emite documento.
     *
     * Um orçamento em elaboração ainda aceita itens e preço; emitir ali
     * produziria um documento oficial de um número que vai mudar. A partir de
     * enviado existe uma proposta que alguém afirmou estar pronta — e emitir
     * continua valendo depois da decisão, porque recusado e expirado são
     * exatamente os que alguém precisa arquivar.
     */
    if (quote.status === 'DRAFT') {
      throw new ConflictException(
        'Um orçamento em elaboração não emite documento: envie-o ao cliente primeiro',
      );
    }

    const { templateId, sections } = await this.template(organizationId);

    const execution = await this.executions.create(organizationId, actorId, {
      businessUnitId: quote.businessUnitId,
      templateId,
      customerId: quote.customerId,
      /* O atendimento convertido, quando houver: o documento cita o serviço e a
         execução fica ligada a ele como a do recibo fica. */
      operationId: quote.operationId ?? undefined,
      responsibleUserId: quote.responsibleUserId ?? undefined,
      /*
       * O código do documento é o da proposta.
       *
       * Não é economia de um contador: é o que faz quem recebeu `ORC-0042`
       * encontrar o documento por esse número. A execução já é identificada pelo
       * seu id; o código é o que a pessoa digita na busca.
       */
      code: quote.code,
      title: `Orçamento ${quote.code} — ${quote.title}`,
      context: {},
      team: [],
    });

    const declarados = this.declaredFields(sections);
    let atual = execution;

    for (const resposta of quoteAnswers(this.toSource(quote))) {
      if (!declarados.has(`${resposta.sectionId}.${resposta.fieldId}`)) {
        /* O modelo da organização não declara este campo. Seguir sem ele é
           melhor que recusar a emissão inteira — e o log diz o que ficou fora. */
        this.logger.warn(
          JSON.stringify({
            event: 'quote_field_not_in_template',
            field: `${resposta.sectionId}.${resposta.fieldId}`,
          }),
        );
        continue;
      }

      atual = await this.executions.saveResponse(
        execution.id,
        organizationId,
        actorId,
        {
          sectionId: resposta.sectionId,
          fieldId: resposta.fieldId,
          value: resposta.value,
          /* A unidade é o que faz o Financeiro reconhecer dinheiro: ele procura
             um campo numérico cuja unidade é código de moeda, não um campo
             chamado "valor". */
          unit: resposta.unit,
          provenance: 'SYSTEM',
        },
      );
    }

    return atual;
  }

  /** A proposta no formato que o mapa de campos entende. */
  private toSource(
    quote: NonNullable<Awaited<ReturnType<QuoteRepository['emissionSource']>>>,
  ): QuoteEmissionSource {
    return {
      code: quote.code,
      title: quote.title,
      notes: quote.notes,
      introText: quote.introText,
      discountReason: quote.discountReason,
      validUntil: quote.validUntil,
      issuedAt: quote.sentAt ?? quote.createdAt,
      total: quote.total,
      items: quote.items,
      customer: quote.customer,
      /* O endereço escolhido vence o principal do cliente — a mesma regra do PDF
         ad hoc, e pelo mesmo motivo: imprimir `addresses[0]` para quem tem duas
         filiais é um chute com aparência de dado. */
      address: quote.serviceAddress ?? quote.customer.addresses[0] ?? null,
      responsibleName: quote.responsible?.displayName,
    };
  }

  /**
   * O modelo de orçamento da organização, ou o oficial.
   *
   * O da organização vence o global: quem publicou o próprio modelo quer emitir
   * no dele. Mesma consulta e mesma ordenação do recibo.
   */
  private template(organizationId: string) {
    return this.rls.run(async (tx) => {
      const template = await tx.artifactTemplate.findFirst({
        where: {
          artifactType: QUOTE_ARTIFACT_TYPE,
          status: 'ACTIVE',
          deletedAt: null,
          OR: [
            { organizationId },
            { organizationId: null, visibility: 'GLOBAL' },
          ],
        },
        orderBy: [{ organizationId: 'desc' }, { createdAt: 'asc' }],
        include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
      });

      if (!template?.versions[0]) {
        throw new EntityNotFoundException('QuoteTemplate', QUOTE_ARTIFACT_TYPE);
      }

      return {
        templateId: template.id,
        sections: template.versions[0].sections,
      };
    });
  }

  /** `secao.campo` de tudo que o modelo declara, para não gravar o que não existe. */
  private declaredFields(sections: unknown): ReadonlySet<string> {
    const declarados = new Set<string>();
    if (!Array.isArray(sections)) return declarados;

    for (const secao of sections) {
      const registro = (secao ?? {}) as Record<string, unknown>;
      const sectionId = registro.id;
      if (typeof sectionId !== 'string') continue;
      const campos = Array.isArray(registro.fields) ? registro.fields : [];
      for (const campo of campos) {
        const fieldId = ((campo ?? {}) as Record<string, unknown>).id;
        if (typeof fieldId === 'string') {
          declarados.add(`${sectionId}.${fieldId}`);
        }
      }
    }
    return declarados;
  }
}

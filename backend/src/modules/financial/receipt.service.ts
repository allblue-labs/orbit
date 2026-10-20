/**
 * Emitir um recibo.
 *
 * ## Por que existe uma porta própria
 *
 * Um recibo é uma execução de artefato do tipo `RECIBO` com seis respostas
 * preenchidas. Deixar o navegador montar isso significaria a tela escolhendo o
 * template, inventando o número, conhecendo os ids de seção e de campo do modelo
 * oficial e sabendo que o valor precisa viajar com a unidade `BRL` — porque é a
 * unidade que faz o Financeiro reconhecer dinheiro. São cinco decisões de domínio
 * numa tela, e cada uma envelhece sozinha.
 *
 * Aqui é uma chamada: o que o recibo diz. O resto é consequência.
 *
 * ## O que esta porta não faz
 *
 * Não emite. Criar o recibo o deixa em rascunho; emitir é renderizar e **publicar o
 * manifesto**, que é o ato que vira receita confirmada no Financeiro. São duas
 * decisões, e juntá-las faria um rascunho conferido pela metade virar dinheiro
 * lançado.
 *
 * ## Do zero ou de um serviço executado
 *
 * `operationId` amarra o recibo ao atendimento: o documento cita o serviço e o
 * Financeiro sabe de onde a receita veio. Sem ele é recibo avulso — adiantamento,
 * acerto, peça vendida no balcão. Os dois preenchem os mesmos campos; a origem
 * decide o que já vem preenchido, não o que o documento é.
 */
import { Injectable, Logger } from '@nestjs/common';
import { RlsTransaction } from '../../database';
import {
  ConflictException,
  EntityNotFoundException,
  ValidationException,
} from '../../exceptions';
import { ArtifactExecutionService } from '../artifact-executions/artifact-execution.service';
import type { ArtifactExecutionReadModel } from '../artifact-executions/artifact-execution.read-models';
import { RECEIPT_ARTIFACT_TYPES } from './financial.constants';
import { allocateReceiptNumber } from './receipt-number';
import type { CreateReceiptDto } from './receipt.dto';

/**
 * Onde cada resposta mora no modelo oficial de recibo.
 *
 * Os ids são do template `ORBIT_RECIBO` e são os mesmos que o compositor premium
 * lê — `pagador`, `valor`, `referente`. O mapa existe para que a ligação entre o
 * que a API recebe e o que o documento imprime fique num lugar só, legível, em vez
 * de espalhada em seis chamadas.
 *
 * Uma organização pode publicar o próprio modelo de recibo; enquanto ele declarar
 * estes campos, funciona. O que não existir no modelo é **ignorado** em vez de
 * derrubar a emissão: um recibo sem "forma de pagamento" é um recibo válido, e
 * recusar a emissão porque o modelo da casa não tem o campo seria pior.
 */
const CAMPOS = [
  { sectionId: 'partes', fieldId: 'pagador', from: 'payer' },
  { sectionId: 'partes', fieldId: 'documento_pagador', from: 'payerDocument' },
  { sectionId: 'partes', fieldId: 'data', from: 'paidOn' },
  { sectionId: 'valor', fieldId: 'valor', from: 'amount', unit: 'BRL' },
  { sectionId: 'valor', fieldId: 'referente', from: 'referring' },
  { sectionId: 'valor', fieldId: 'forma_pagamento', from: 'paymentMethod' },
] as const;

@Injectable()
export class ReceiptService {
  private readonly logger = new Logger(ReceiptService.name);

  constructor(
    private readonly rls: RlsTransaction,
    private readonly executions: ArtifactExecutionService,
  ) {}

  async create(
    organizationId: string,
    contextBusinessUnitId: string | null,
    actorId: string,
    input: CreateReceiptDto,
  ): Promise<ArtifactExecutionReadModel> {
    const businessUnitId = input.businessUnitId ?? contextBusinessUnitId;
    if (!businessUnitId) {
      throw new ValidationException(
        'A unidade emissora é obrigatória: o recibo sai no papel dela',
      );
    }

    const { templateId, code, sections } = await this.rls.run(async (tx) => {
      const template = await tx.artifactTemplate.findFirst({
        where: {
          artifactType: { in: [...RECEIPT_ARTIFACT_TYPES] },
          status: 'ACTIVE',
          deletedAt: null,
          OR: [
            { organizationId },
            { organizationId: null, visibility: 'GLOBAL' },
          ],
        },
        /* O da organização vence o global: quem publicou o próprio modelo quer
           emitir no dele. `organizationId` nulo ordena por último em `desc`
           porque `NULLS LAST` é o padrão do PostgreSQL nessa direção. */
        orderBy: [{ organizationId: 'desc' }, { createdAt: 'asc' }],
        include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
      });

      if (!template?.versions[0]) {
        throw new EntityNotFoundException('ReceiptTemplate', 'RECIBO');
      }

      return {
        templateId: template.id,
        code: await allocateReceiptNumber(tx, organizationId),
        sections: template.versions[0].sections,
      };
    });

    /*
     * O número vai no código **e** no título.
     *
     * O código é a identidade; o título é o que aparece em lista, em notificação e
     * no cabeçalho do documento. Um título sem número obrigaria quem procura o
     * recibo 42 a abrir os recibos um por um.
     */
    const execution = await this.executions.create(organizationId, actorId, {
      businessUnitId,
      templateId,
      operationId: input.operationId,
      customerId: input.customerId,
      code,
      title: `Recibo ${code} — ${input.payer}`,
      /*
       * Vazios por padrão no DTO, e explícitos aqui porque o tipo os exige: o
       * recibo não guarda contexto próprio — o que ele afirma está nas respostas —
       * e não tem equipe: quem recebeu é quem assina, e a assinatura é do
       * documento.
       */
      context: {},
      team: [],
    });

    /*
     * As respostas vão uma a uma, e **não** na mesma transação da criação.
     *
     * A API de execução grava uma resposta por chamada, com validação de campo
     * contra o snapshot congelado. Reimplementar isso aqui para ganhar atomicidade
     * duplicaria a validação — e o estado intermediário é legítimo: um recibo
     * meio preenchido é um rascunho, e rascunho é editável. O que não acontece é
     * virar dinheiro: receita só existe quando o manifesto é emitido.
     */
    const declarados = this.declaredFields(sections);
    let atual = execution;

    for (const campo of CAMPOS) {
      const valor = input[campo.from];
      if (valor === undefined || valor === '') continue;
      if (!declarados.has(`${campo.sectionId}.${campo.fieldId}`)) {
        /* O modelo da casa não tem este campo. Seguir sem ele é melhor que recusar
           a emissão inteira — e o log diz o que ficou de fora. */
        this.logger.warn(
          JSON.stringify({
            event: 'receipt_field_not_in_template',
            field: `${campo.sectionId}.${campo.fieldId}`,
          }),
        );
        continue;
      }

      atual = await this.executions.saveResponse(
        execution.id,
        organizationId,
        actorId,
        {
          sectionId: campo.sectionId,
          fieldId: campo.fieldId,
          value: valor,
          /* A unidade é o que faz o Financeiro reconhecer dinheiro: ele procura um
             campo numérico cuja unidade é código de moeda, não um campo chamado
             "valor". */
          unit: 'unit' in campo ? campo.unit : undefined,
          provenance: 'USER',
        },
      );
    }

    return atual;
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

  /**
   * O atendimento que origina o recibo, com o que ele tem a oferecer de pronto.
   *
   * Concluído, e só concluído: recibo é prova de pagamento por serviço **feito**, e
   * oferecer um atendimento em andamento convidaria a receber antes de entregar —
   * decisão comercial que o sistema não deve sugerir.
   */
  async eligibleOperation(organizationId: string, operationId: string) {
    const operation = await this.rls.run((tx) =>
      tx.operation.findFirst({
        where: { id: operationId, organizationId, deletedAt: null },
        select: {
          id: true,
          code: true,
          serviceOrderNumber: true,
          title: true,
          status: true,
          completedAt: true,
          customer: {
            select: {
              id: true,
              legalName: true,
              tradeName: true,
              documentNumber: true,
            },
          },
        },
      }),
    );

    if (!operation) throw new EntityNotFoundException('Operation', operationId);
    if (operation.status !== 'COMPLETED') {
      throw new ConflictException(
        'O recibo prova pagamento de serviço concluído; este atendimento ainda não foi',
      );
    }
    return operation;
  }
}

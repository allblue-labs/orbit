import { Injectable } from '@nestjs/common';
import { RlsTransaction } from '../../database';

/**
 * As consultas do pedido de cancelamento.
 *
 * Tudo sob `rls.run`: o pedido é por organização, e a política da tabela é a mesma
 * de todo o resto — o tenant sai do contexto da transação, nunca de um parâmetro que
 * alguém possa esquecer de passar.
 */
@Injectable()
export class OperationCancellationRepository {
  constructor(private readonly rls: RlsTransaction) {}

  /**
   * O atendimento, com a escala e o pedido pendente.
   *
   * Uma consulta só porque as três perguntas são feitas juntas, sempre: existe, é
   * desta pessoa, e já há pedido em aberto. Separá-las abriria janela entre a
   * verificação e o registro.
   */
  operationForRequest(organizationId: string, operationId: string) {
    return this.rls.run((tx) =>
      tx.operation.findFirst({
        where: { id: operationId, organizationId, deletedAt: null },
        select: {
          id: true,
          businessUnitId: true,
          status: true,
          responsibleFieldTechnicianId: true,
          auxiliaryTechnicians: {
            where: { removedAt: null },
            select: { userId: true },
          },
          cancellationRequests: {
            where: { status: 'PENDING' },
            select: { id: true },
            take: 1,
          },
        },
      }),
    );
  }

  /**
   * Registra o pedido e marca as fotos citadas, numa transação.
   *
   * As duas coisas juntas porque um pedido que cita fotos e não as marca deixa o
   * dono lendo a justificativa sem ver o que a sustenta — e marcar fotos sem pedido
   * deixa linhas apontando para nada.
   *
   * As fotos são citadas pelo id **local** da captura, e conferidas contra a própria
   * operação: o id vem do aplicativo, e aceitar qualquer um deixaria um pedido
   * apontar para a foto de outro atendimento.
   *
   * O que ainda não subiu não é carimbado aqui — não existe linha a carimbar. Quem
   * fecha essa lacuna é a finalização do upload, que pergunta se aquele
   * `localMediaId` foi citado por um pedido em aberto.
   */
  create(input: {
    organizationId: string;
    businessUnitId: string;
    operationId: string;
    reason: string;
    requestedById: string;
    evidenceLocalIds: readonly string[];
  }) {
    return this.rls.run(async (tx) => {
      const request = await tx.operationCancellationRequest.create({
        data: {
          organizationId: input.organizationId,
          businessUnitId: input.businessUnitId,
          operationId: input.operationId,
          reason: input.reason.trim(),
          requestedById: input.requestedById,
          requestedAt: new Date(),
        },
      });

      if (input.evidenceLocalIds.length > 0) {
        await tx.operationCancellationRequest.update({
          where: { id: request.id },
          data: { citedLocalMediaIds: [...input.evidenceLocalIds] },
        });
        await tx.fieldEvidence.updateMany({
          where: {
            localMediaId: { in: [...input.evidenceLocalIds] },
            organizationId: input.organizationId,
            operationId: input.operationId,
          },
          data: { cancellationRequestId: request.id },
        });
      }

      return request;
    });
  }

  /** O pedido pendente de um atendimento, para a projeção da fila. */
  pendingFor(organizationId: string, operationIds: readonly string[]) {
    if (operationIds.length === 0) return Promise.resolve([]);
    return this.rls.run((tx) =>
      tx.operationCancellationRequest.findMany({
        where: {
          organizationId,
          status: 'PENDING',
          operationId: { in: [...operationIds] },
        },
        select: {
          id: true,
          operationId: true,
          reason: true,
          requestedAt: true,
        },
      }),
    );
  }

  /** A caixa de entrada do dono. */
  inbox(organizationId: string, status: 'PENDING' | 'RESOLVED') {
    return this.rls.run((tx) =>
      tx.operationCancellationRequest.findMany({
        where: { organizationId, status },
        orderBy: { requestedAt: 'desc' },
        take: 100,
        select: {
          id: true,
          status: true,
          reason: true,
          requestedAt: true,
          resolution: true,
          resolutionNotes: true,
          resolvedAt: true,
          requestedBy: { select: { id: true, displayName: true } },
          resolvedBy: { select: { id: true, displayName: true } },
          operation: {
            select: {
              id: true,
              code: true,
              title: true,
              status: true,
              scheduledStart: true,
              customer: { select: { tradeName: true, legalName: true } },
            },
          },
          evidence: {
            select: {
              id: true,
              fileName: true,
              mimeType: true,
              capturedAt: true,
            },
          },
        },
      }),
    );
  }

  byId(organizationId: string, id: string) {
    return this.rls.run((tx) =>
      tx.operationCancellationRequest.findFirst({
        where: { id, organizationId },
        select: {
          id: true,
          status: true,
          operationId: true,
          operation: { select: { id: true, businessUnitId: true } },
        },
      }),
    );
  }

  /**
   * Fecha o pedido.
   *
   * `status: 'PENDING'` no `where` é o que torna a resolução idempotente sob
   * concorrência: dois donos decidindo ao mesmo tempo, o segundo não sobrescreve o
   * desfecho do primeiro — a atualização simplesmente não encontra linha.
   */
  resolve(input: {
    organizationId: string;
    id: string;
    resolution: string;
    notes?: string;
    resolvedById: string;
  }) {
    return this.rls.run((tx) =>
      tx.operationCancellationRequest.updateMany({
        where: {
          id: input.id,
          organizationId: input.organizationId,
          status: 'PENDING',
        },
        data: {
          status: 'RESOLVED',
          resolution: input.resolution,
          resolutionNotes: input.notes?.trim() || null,
          resolvedById: input.resolvedById,
          resolvedAt: new Date(),
        },
      }),
    );
  }
}

import { Injectable } from '@nestjs/common';
import {
  ConflictException,
  EntityNotFoundException,
  ForbiddenException,
} from '../../exceptions';
import { OperationCancellationRepository } from './operation-cancellation.repository';
import type {
  OperationCancellationInboxItemReadModel,
  OperationCancellationRequestReadModel,
  OperationCancellationResolution,
} from './operation-cancellation.read-models';

/** Quem pede, do lado do aplicativo. */
export interface CancellationRequester {
  id: string;
  organizationId: string;
}

/**
 * O pedido de cancelamento: quem pede em campo, quem decide no painel.
 *
 * ## As duas autoridades são diferentes, e é o ponto
 *
 * Pedir exige estar **escalado naquele atendimento** — responsável ou auxiliar —, e
 * nada mais: é o relato de quem está na porta, e exigir permissão administrativa de
 * quem só tem o aplicativo tornaria o relato impossível.
 *
 * Decidir exige `operations.status.update`, a mesma permissão de mudar o estado de
 * um atendimento — porque é exatamente isso que a decisão faz. Um técnico não
 * encerra compromisso comercial; ele avisa.
 *
 * ## Estados que já não aceitam pedido
 *
 * Concluído e cancelado. O primeiro porque o serviço foi feito, e um pedido ali não
 * descreve nada que ainda possa ser decidido; o segundo porque já está cancelado.
 */
@Injectable()
export class OperationCancellationService {
  constructor(private readonly repository: OperationCancellationRepository) {}

  async request(
    actor: CancellationRequester,
    operationId: string,
    input: { reason: string; evidenceLocalIds?: readonly string[] },
  ): Promise<OperationCancellationRequestReadModel> {
    const operation = await this.repository.operationForRequest(
      actor.organizationId,
      operationId,
    );
    if (!operation) throw new EntityNotFoundException('Operation', operationId);

    const escalado =
      operation.responsibleFieldTechnicianId === actor.id ||
      operation.auxiliaryTechnicians.some((aux) => aux.userId === actor.id);
    if (!escalado)
      throw new ForbiddenException(
        'Somente quem está escalado no atendimento pode pedir o cancelamento',
      );

    if (operation.status === 'COMPLETED' || operation.status === 'CANCELLED')
      throw new ConflictException(
        'Este atendimento já foi encerrado e não aceita pedido de cancelamento',
      );

    /*
     * Pedido pendente devolve o que já existe, em vez de 409.
     *
     * O caminho real é um aplicativo offline reenviando: a rede caiu depois de
     * gravar, e a segunda tentativa não pode virar erro na cara de quem já
     * justificou. O índice parcial no banco garante o resto.
     */
    const pendente = operation.cancellationRequests[0];
    if (pendente) {
      const atual = await this.repository.inbox(
        actor.organizationId,
        'PENDING',
      );
      const encontrado = atual.find((item) => item.id === pendente.id);
      if (encontrado) return this.summary(encontrado);
    }

    const created = await this.repository.create({
      organizationId: actor.organizationId,
      businessUnitId: operation.businessUnitId,
      operationId: operation.id,
      reason: input.reason,
      requestedById: actor.id,
      evidenceLocalIds: input.evidenceLocalIds ?? [],
    });

    return {
      id: created.id,
      status: 'PENDING',
      reason: created.reason,
      requestedAt: created.requestedAt.toISOString(),
      resolution: null,
      resolutionNotes: null,
      resolvedAt: null,
    };
  }

  async inbox(
    organizationId: string,
    status: 'PENDING' | 'RESOLVED' = 'PENDING',
  ): Promise<OperationCancellationInboxItemReadModel[]> {
    const rows = await this.repository.inbox(organizationId, status);
    return rows.map((row) => ({
      ...this.summary(row),
      operation: {
        id: row.operation.id,
        code: row.operation.code,
        title: row.operation.title,
        status: row.operation.status,
        scheduledStart: row.operation.scheduledStart?.toISOString() ?? null,
        customerName:
          row.operation.customer?.tradeName ??
          row.operation.customer?.legalName ??
          null,
      },
      requestedBy: row.requestedBy,
      resolvedBy: row.resolvedBy,
      evidence: row.evidence.map((item) => ({
        id: item.id,
        fileName: item.fileName,
        mimeType: item.mimeType,
        capturedAt: item.capturedAt?.toISOString() ?? null,
      })),
    }));
  }

  /**
   * Fecha o pedido com o desfecho que o dono escolheu.
   *
   * **Não** executa o reagendamento nem a reatribuição: quem faz isso é o serviço de
   * operações, pelas rotas que já existem e que já sabem registrar histórico,
   * notificar e validar escala. Aqui se registra a decisão; o chamador encadeia a
   * ação. Duplicar `update` e `replaceResponsibleFieldTechnician` aqui dentro criaria
   * um segundo caminho para mudar atendimento, e os dois divergiriam.
   */
  async resolve(
    organizationId: string,
    actorId: string,
    id: string,
    input: { resolution: OperationCancellationResolution; notes?: string },
  ): Promise<{ operationId: string }> {
    const pedido = await this.repository.byId(organizationId, id);
    if (!pedido)
      throw new EntityNotFoundException('OperationCancellationRequest', id);
    if (pedido.status !== 'PENDING')
      throw new ConflictException('Este pedido já foi resolvido');

    const { count } = await this.repository.resolve({
      organizationId,
      id,
      resolution: input.resolution,
      notes: input.notes,
      resolvedById: actorId,
    });
    /* Zero linhas: outra pessoa resolveu entre a leitura e a escrita. */
    if (count === 0)
      throw new ConflictException('Este pedido já foi resolvido');

    return { operationId: pedido.operationId };
  }

  private summary(row: {
    id: string;
    status: string;
    reason: string;
    requestedAt: Date;
    resolution: string | null;
    resolutionNotes: string | null;
    resolvedAt: Date | null;
  }): OperationCancellationRequestReadModel {
    return {
      id: row.id,
      status: row.status as 'PENDING' | 'RESOLVED',
      reason: row.reason,
      requestedAt: row.requestedAt.toISOString(),
      resolution: row.resolution as OperationCancellationResolution | null,
      resolutionNotes: row.resolutionNotes,
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
    };
  }
}

/**
 * O pedido de cancelamento feito em campo, como cada lado o enxerga.
 *
 * Duas visões porque são duas perguntas. O técnico pergunta "o meu pedido foi
 * lido?"; o dono pergunta "o que aconteceu lá, e o que eu faço com este
 * atendimento?". A segunda precisa de quem pediu, do atendimento e das fotos; a
 * primeira, não — quem pediu já sabe que foi ele.
 */

/** O que o dono pode decidir. Catálogo fechado: a tela não inventa desfecho. */
export type OperationCancellationResolution =
  'CANCELLED' | 'RESCHEDULED' | 'REASSIGNED' | 'DISMISSED';

export type OperationCancellationStatus = 'PENDING' | 'RESOLVED';

/** O pedido na visão de quem o fez. */
export interface OperationCancellationRequestReadModel {
  id: string;
  status: OperationCancellationStatus;
  reason: string;
  requestedAt: string;
  resolution: OperationCancellationResolution | null;
  resolutionNotes: string | null;
  resolvedAt: string | null;
}

/**
 * Uma foto apresentada junto do pedido.
 *
 * Só o necessário para listar e pedir o acesso temporário: os bytes continuam
 * saindo pela rota de evidência, que é quem sabe emitir a concessão assinada.
 */
export interface OperationCancellationEvidenceReadModel {
  id: string;
  fileName: string;
  mimeType: string;
  capturedAt: string | null;
}

/** O pedido na visão de quem decide. */
export interface OperationCancellationInboxItemReadModel extends OperationCancellationRequestReadModel {
  operation: {
    id: string;
    code: string;
    title: string;
    status: string;
    scheduledStart: string | null;
    customerName: string | null;
  };
  requestedBy: { id: string; displayName: string };
  resolvedBy: { id: string; displayName: string } | null;
  evidence: readonly OperationCancellationEvidenceReadModel[];
}

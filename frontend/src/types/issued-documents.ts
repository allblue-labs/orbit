/**
 * Documentos emitidos — as duas origens, num tipo só.
 *
 * O backend une `artifact_executions` e `management_reports` no banco, e publica
 * uma linha com o que cada origem tem. Metade dos campos é nula de propósito: uma
 * execução tem código, título, cliente e atendimento; um relatório gerencial tem
 * tipo e período, e não tem cliente — ele retrata a operação inteira num
 * intervalo. Ver `issued-document.read-models.ts`.
 */
import type { PaginatedResult } from "./api";

export type IssuedDocumentSource = "EXECUTION" | "REPORT";

export interface IssuedDocument {
  readonly source: IssuedDocumentSource;
  readonly id: string;
  readonly code: string | null;
  readonly title: string | null;
  readonly type: string;
  readonly renderStatus: string;
  readonly status: string;
  readonly businessUnitId: string | null;
  readonly customerId: string | null;
  readonly operationId: string | null;
  readonly createdAt: string;
  readonly issuedAt: string | null;
  readonly revisions: number;
  readonly periodFrom: string | null;
  /**
   * O intervalo que o relatório retrata, em meia-noite **UTC** da data civil
   * escolhida — o formulário manda `YYYY-MM-DD` e o contrato o lê assim. Formatar
   * no fuso de quem olha faz um período de março dizer fevereiro.
   */
  readonly periodTo: string | null;
}

export type IssuedDocumentList = PaginatedResult<IssuedDocument>;

export interface IssuedDocumentQuery {
  source?: IssuedDocumentSource;
  businessUnitId?: string;
  customerId?: string;
  operationId?: string;
  renderStatus?: string;
  artifactType?: string;
  createdFrom?: string;
  createdTo?: string;
  search?: string;
  page?: number;
  limit?: number;
}

/**
 * De onde o documento veio.
 *
 * O rótulo diz o motor, não a tecnologia: quem lê a lista precisa saber que um é
 * documento de atendimento e o outro é retrato de um período, porque o que se faz
 * com cada um é diferente.
 */
export const ISSUED_DOCUMENT_SOURCE_LABELS: Readonly<
  Record<IssuedDocumentSource, string>
> = {
  EXECUTION: "Execução",
  REPORT: "Relatório",
};

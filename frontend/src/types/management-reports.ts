/**
 * Contratos do Management Reports Engine.
 *
 * Nenhum Read Model é redeclarado: todos vêm de
 * `contracts/modules/management-reports`. O que este arquivo acrescenta são os
 * tipos de entrada e os rótulos.
 *
 * ## Isto não é o `/reports` operacional
 *
 * O Orbit tem **dois** conceitos com o mesmo nome, e eles não se misturam:
 *
 * - `/api/v1/reports` — relatório **de visita**, pertence a uma operação, é
 *   preenchido em campo e assinado. Vive no Document Center;
 * - `/api/v1/management-reports` — relatório **gerencial**, agrega um período
 *   inteiro, não tem dono operacional e não é assinado. Vive aqui.
 *
 * Este arquivo fala só do segundo, e nada aqui importa do primeiro.
 *
 * ## O catálogo é do servidor
 *
 * Tipos, parâmetros, domínios, formatos e capabilities chegam por
 * `GET /management-reports/catalog` — inclusive `allowed` e `blockedReason`
 * para a sessão. **Não existe lista de tipos escrita aqui**: um tipo novo do
 * backend precisa aparecer sozinho, e um que sair precisa sumir sozinho.
 *
 * ## Número viaja como texto
 *
 * `value` das métricas é `string`, como no Financeiro e no Estoque. Quem
 * exibe formata; ninguém soma no cliente — somar aqui produziria um total que
 * o snapshot não tem, e o snapshot é a prova.
 */
import type {
  ManagementReportReadModel,
  ManagementReportStatusReadModel,
  ManagementReportSummaryReadModel,
  ReportCatalogReadModel,
  ReportMetricReadModel,
  ReportProvenance,
  ReportSectionReadModel,
  ReportSnapshotReadModel,
  ReportSourceReadModel,
  ReportTableReadModel,
} from "./contracts/modules/management-reports/report.read-models";

export type {
  ManagementReportReadModel,
  ReportProvenance,
  ReportSnapshotReadModel,
};

export type ManagementReport = ManagementReportReadModel;
export type ManagementReportSummary = ManagementReportSummaryReadModel;
export type ManagementReportStatus = ManagementReportStatusReadModel;
export type ReportCatalog = ReportCatalogReadModel;
export type ReportCatalogType = ReportCatalog["types"][number];
export type ReportSnapshot = ReportSnapshotReadModel;
export type ReportSection = ReportSectionReadModel;
export type ReportMetric = ReportMetricReadModel;
export type ReportTable = ReportTableReadModel;
export type ReportSource = ReportSourceReadModel;

/* -------------------------------------------------------------------- */
/* Entradas                                                              */
/* -------------------------------------------------------------------- */

/**
 * Pedido de geração.
 *
 * **Sem `timezone`.** O backend o resolve da unidade de negócio e o ecoa no
 * snapshot; mandar o do navegador faria "outubro" começar em horas diferentes
 * conforme quem clicou.
 *
 * As datas viajam como `YYYY-MM-DD`: o recorte é de dias, e o servidor é quem
 * decide onde o dia começa.
 */
export interface GenerateReportInput {
  type: string;
  dateFrom: string;
  dateTo: string;
  businessUnitId?: string;
  customerId?: string;
  operationKind?: string;
  operationStatus?: string;
  format?: string;
}

export interface ManagementReportQuery {
  type?: string;
  status?: string;
  businessUnitId?: string;
  generatedById?: string;
  /** Recorte pela data de **geração**, não pelo período analisado. */
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

/* -------------------------------------------------------------------- */
/* Apresentação                                                          */
/* -------------------------------------------------------------------- */

/** Os quatro estados publicados pelo backend. Valor novo aparece cru. */
export const REPORT_STATUS_LABELS: Readonly<Record<string, string>> = {
  PENDING: "Na fila",
  GENERATING: "Compondo",
  READY: "Pronto",
  FAILED: "Falhou",
};

export const REPORT_STATUS_CLASSES: Readonly<Record<string, string>> = {
  PENDING: "bg-surface-strong text-muted-foreground",
  GENERATING: "bg-warning/15 text-warning",
  READY: "bg-success/15 text-success",
  FAILED: "bg-destructive/15 text-destructive",
};

/** `true` enquanto o servidor ainda está trabalhando. */
export function isInFlight(status: string): boolean {
  return status === "PENDING" || status === "GENERATING";
}

export const REPORT_PROVENANCE_LABELS: Readonly<Record<string, string>> = {
  OBSERVED: "Observado",
  DERIVED: "Derivado",
  PROXY: "Aproximado",
  MOCK: "Simulado",
};

/**
 * Cor por procedência.
 *
 * `PROXY` e `MOCK` recebem tom de atenção **de propósito**: um número
 * aproximado num relatório gerencial precisa ser visivelmente diferente de um
 * número observado, ou ninguém nota a diferença na hora de decidir.
 */
export const REPORT_PROVENANCE_CLASSES: Readonly<Record<string, string>> = {
  OBSERVED: "bg-success/15 text-success",
  DERIVED: "bg-chart-1/15 text-chart-1",
  PROXY: "bg-warning/15 text-warning",
  MOCK: "bg-warning/15 text-warning",
};

export const REPORT_PROVENANCE_DESCRIPTIONS: Readonly<
  Record<string, string>
> = {
  OBSERVED: "Contado direto do registro que o originou.",
  DERIVED: "Calculado a partir de números observados.",
  PROXY: "Aproximação declarada — não é medição direta.",
  MOCK: "Fonte simulada. Não use para decidir.",
};

/** Rótulo dos domínios que um relatório declara usar. */
export const REPORT_DOMAIN_LABELS: Readonly<Record<string, string>> = {
  OPERATIONS: "Operações",
  SCHEDULING: "Agenda",
  FINANCIAL: "Financeiro",
  COMMERCIAL: "Comercial",
  INVENTORY: "Estoque",
  DOCUMENTS: "Documentos",
  WORKFORCE: "Equipe",
  ANALYTICS: "Analytics",
};

/** Rótulo dos parâmetros publicados pelo catálogo. */
export const REPORT_PARAMETER_LABELS: Readonly<Record<string, string>> = {
  businessUnitId: "Organização",
  customerId: "Cliente",
  operationKind: "Tipo de operação",
  operationStatus: "Situação da operação",
};

export const reportDomainLabel = (domain: string): string =>
  REPORT_DOMAIN_LABELS[domain] ?? domain;

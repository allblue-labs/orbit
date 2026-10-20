/**
 * Tipos do RVT V2 — Web.
 *
 * Os Read Models vêm dos **contracts sincronizados** (`contracts:sync`), não
 * de cópias escritas à mão: RVT foi publicado pelo backend e reescrever as
 * formas aqui criaria uma segunda verdade que envelhece em silêncio.
 *
 * O que este arquivo acrescenta é só o que o contrato não publica: as formas
 * de **entrada** (derivadas dos DTOs) e as queries.
 *
 * ## Lacunas conhecidas do contrato
 *
 * `recurrence`, `procedure`, `serviceLocation`, `observations`,
 * `recommendations` e `customerAcknowledgement` chegam como `unknown` — são
 * colunas JSON livres, sem forma publicada. Não são convertidas com `as`: o
 * que a tela precisa ler passa por uma checagem em tempo de execução.
 */
import type {
  RvtConfigurationReadModel,
  RvtEquipmentReadModel,
  RvtExecutionReadModel,
  RvtOccurrenceReadModel,
  RvtPartyReadModel,
  RvtTimelineItemReadModel,
  RvtMaintenanceTypeReadModel,
} from "./contracts/modules/rvt/rvt.read-models";

export type RvtConfiguration = RvtConfigurationReadModel;
export type RvtOccurrence = RvtOccurrenceReadModel;
export type RvtExecution = RvtExecutionReadModel;
export type RvtEquipment = RvtEquipmentReadModel;
export type RvtParty = RvtPartyReadModel;
export type RvtTimelineItem = RvtTimelineItemReadModel;

/**
 * Lista e detalhe têm a **mesma** forma.
 *
 * `GET /rvt/configurations` monta cada linha com o mesmo mapper do detalhe —
 * conferido no backend, não presumido. Por isso não há `RvtConfigurationListItem`
 * aqui: inventar um tipo mais pobre do que a resposta faria o compilador
 * proteger uma mentira, e um tipo mais rico repetiria o erro de `Operation`
 * que a FE-01 corrigiu.
 */
export type RvtConfigurationListItem = RvtConfigurationReadModel;

/* ------------------------------------------------------------------ */
/* Consultas                                                           */
/* ------------------------------------------------------------------ */

export interface RvtConfigurationQuery {
  businessUnitId?: string;
  customerId?: string;
  status?: string;
  cursor?: string;
  limit?: number;
}

export interface RvtOccurrenceQuery {
  businessUnitId?: string;
  assignedToUserId?: string;
  status?: string;
  cursor?: string;
  limit?: number;
}

export interface RvtTimelineQuery {
  cursor?: string;
  limit?: number;
}

/** Página por cursor, como o backend a devolve. */
export interface RvtCursorPage<T> {
  data: T[];
  nextCursor: string | null;
  hasNextPage: boolean;
}

/* ------------------------------------------------------------------ */
/* Entradas                                                            */
/* ------------------------------------------------------------------ */

/** Espelha `CreateRvtConfigurationDto`. */
export interface CreateRvtConfigurationInput {
  businessUnitId: string;
  customerId: string;
  code: string;
  name: string;
  /**
   * O tipo de manutenção, escolhido da Central de Catálogos.
   *
   * Eram dois literais fixos. A cadência e o checklist do contrato saem do
   * tipo, então o que viaja é o id do cadastro, não um código de calendário.
   */
  maintenanceTypeId: string;
  scheduleMode: "RECURRING" | "ONE_TIME";
  coverageStart: string;
  coverageEnd?: string;
  timezone: string;
  serviceLocation: Record<string, unknown>;
  recurrence?: Record<string, unknown>;
  procedure: Record<string, unknown>;
  technicalResponsibleUserId?: string;
  defaultResponsibleFieldTechnicianId?: string;
  requiresTechnicalResponsible?: boolean;
  equipmentIds?: string[];
}

/**
 * Espelha `UpdateRvtConfigurationDto`.
 *
 * Unidade, cliente, código e modo de agenda estão fora por decisão de domínio
 * — o DTO os marca como `never`. Trocar qualquer um transformaria a
 * configuração em outra, com as visitas da anterior penduradas nela.
 */
export type UpdateRvtConfigurationInput = Partial<
  Omit<
    CreateRvtConfigurationInput,
    "businessUnitId" | "customerId" | "code" | "scheduleMode"
  >
>;

/**
 * O que o servidor fez com a agenda depois da edição.
 *
 * Só ocorrências futuras e intocadas são reconciliadas; as realizadas
 * permanecem. Estes três números vêm de lá — a tela não os deduz comparando
 * listas.
 */
export interface RvtReconciliation {
  created: number;
  cancelled: number;
  rescheduled: number;
}

export interface RvtUpdateResult {
  configuration: RvtConfiguration;
  reconciliation: RvtReconciliation;
}

/* ------------------------------------------------------------------ */
/* Leitura defensiva do JSON livre                                     */
/* ------------------------------------------------------------------ */

/** O aceite do cliente, quando o servidor o publicou nesta forma. */
export interface RvtAcknowledgement {
  name: string;
  signedAt: string | null;
  hash: string | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Lê o aceite sem afirmar a forma.
 *
 * O campo é `unknown` no contrato porque é JSON livre no banco. Um `as`
 * silenciaria o compilador e deixaria a tela quebrar em produção quando a
 * forma mudasse; a checagem devolve `null` e a tela mostra "sem aceite", que
 * é a verdade observável.
 */
export function readAcknowledgement(value: unknown): RvtAcknowledgement | null {
  if (!isRecord(value)) return null;
  const name = value.name;
  if (typeof name !== "string" || name.trim() === "") return null;
  return {
    name,
    signedAt: typeof value.signedAt === "string" ? value.signedAt : null,
    hash: typeof value.hash === "string" ? value.hash : null,
  };
}

/**
 * Uma anotação da visita, reduzida ao que dá para mostrar.
 *
 * `observations` e `recommendations` são arrays de JSON livre: o backend não
 * publica forma, e o app de campo grava o que o procedimento pedir. Em vez de
 * inventar um esquema, a tela mostra os pares texto que existirem — nada é
 * escondido e nada é presumido.
 */
export interface RvtNote {
  readonly entries: readonly { label: string; value: string }[];
}

export function readNotes(value: unknown): readonly RvtNote[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string")
      return item.trim() ? [{ entries: [{ label: "", value: item }] }] : [];
    if (!isRecord(item)) return [];
    const entries = Object.entries(item)
      .filter(
        ([, entry]) =>
          typeof entry === "string" ||
          typeof entry === "number" ||
          typeof entry === "boolean",
      )
      .map(([label, entry]) => ({ label, value: String(entry) }));
    return entries.length > 0 ? [{ entries }] : [];
  });
}

/* ------------------------------------------------------------------ */
/* Tipos de manutenção                                                 */
/* ------------------------------------------------------------------ */

export type RvtMaintenanceType = RvtMaintenanceTypeReadModel;

/** `POST /rvt/maintenance-types`. */
export interface CreateRvtMaintenanceTypeInput {
  key: string;
  label: string;
  /** Cadência em dias. Exclusivo com `intervalMonths`. */
  intervalDays?: number;
  /** Cadência em meses de calendário. Exclusivo com `intervalDays`. */
  intervalMonths?: number;
  /** O roteiro que o técnico preenche na visita deste tipo. */
  checklistTemplateId?: string;
  sortOrder?: number;
}

/**
 * `null` apaga, ausente mantém.
 *
 * Dia e mês são exclusivos: trocar a unidade exige mandar a antiga como `null`,
 * senão o servidor vê as duas preenchidas e recusa. O mesmo vale para tirar o
 * roteiro de um tipo.
 */
export type UpdateRvtMaintenanceTypeInput = Partial<
  Omit<
    CreateRvtMaintenanceTypeInput,
    "key" | "intervalDays" | "intervalMonths" | "checklistTemplateId"
  >
> & {
  intervalDays?: number | null;
  intervalMonths?: number | null;
  checklistTemplateId?: string | null;
  isActive?: boolean;
};

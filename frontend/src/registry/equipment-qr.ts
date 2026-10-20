/**
 * Como a identidade QR do equipamento aparece na tela.
 *
 * ## O que o QR é, e o que ele não é
 *
 * ```text
 * identidade  → um token opaco que aponta para UM equipamento
 * etiqueta    → a arte impressa, gerada pelo backend
 * resolução   → abrir o contexto operacional daquele equipamento
 * ```
 *
 * O QR **não é credencial**: ler o código não concede acesso, papel nem
 * atribuição — quem resolve o token continua precisando das próprias
 * permissões, e é o servidor que as confere. E o QR **não é comando**:
 * resolver nunca cria nem inicia atendimento.
 *
 * Este arquivo só traduz. Nada aqui decide o que pode ser feito com um
 * equipamento — isso é `allowedActions`, publicado por
 * `GET /assets/qr/:token`.
 */
import type { EquipmentFieldAction } from "@/types/contracts/modules/organizations/business-units/equipaments/equipment-qr.read-models";

export type QrTone = "neutral" | "info" | "warning" | "critical" | "success";

export interface QrPresentation {
  readonly label: string;
  readonly tone: QrTone;
  readonly description?: string;
}

/* ------------------------------------------------------------------ */
/* Situação da identidade                                              */
/* ------------------------------------------------------------------ */

/**
 * `ACTIVE` e `REVOKED` são os dois estados que a tabela guarda.
 *
 * Na prática a tela quase só vê o primeiro: o resumo devolve a identidade
 * **ativa**, e o banco garante que sempre existe uma. `Substituída` está aqui
 * porque é o estado real da identidade anterior depois de uma rotação — e
 * chamá-la de "revogada" sugeriria que o equipamento ficou sem QR, que é
 * exatamente o que não acontece.
 */
export const QR_STATUS: Readonly<Record<string, QrPresentation>> = {
  ACTIVE: {
    label: "Ativa",
    tone: "success",
    description: "Esta é a etiqueta válida do equipamento.",
  },
  REVOKED: {
    label: "Substituída",
    tone: "neutral",
    description: "Deixou de resolver quando uma nova identidade foi gerada.",
  },
};

/* ------------------------------------------------------------------ */
/* Formatos de etiqueta                                                */
/* ------------------------------------------------------------------ */

/**
 * Três formatos, um propósito cada.
 *
 * Todos são gerados pelo backend, com a mesma arte: o navegador não redesenha
 * etiqueta nem recodifica payload. A escolha é de uso, não de aparência.
 */
export const LABEL_FORMATS = [
  {
    format: "svg",
    label: "SVG",
    hint: "Vetor — imprime em qualquer tamanho sem perder nitidez.",
  },
  {
    format: "png",
    label: "PNG",
    hint: "Imagem — para colar em documento ou enviar por mensagem.",
  },
  {
    format: "pdf",
    label: "PDF",
    hint: "Pronto para impressão.",
  },
] as const;

export type LabelFormat = (typeof LABEL_FORMATS)[number]["format"];

/** O `Content-Type` que cada formato deve trazer de volta. */
export const LABEL_CONTENT_TYPES: Readonly<Record<LabelFormat, string>> = {
  svg: "image/svg+xml",
  png: "image/png",
  pdf: "application/pdf",
};

/* ------------------------------------------------------------------ */
/* Ações do contexto resolvido                                         */
/* ------------------------------------------------------------------ */

/**
 * O que fazer com o equipamento depois de resolver o QR.
 *
 * A lista vem de `allowedActions`, montada pelo servidor a partir das
 * permissões do ator, do estado do equipamento e dos contextos de PMOC e RVT.
 * A tela traduz e nunca acrescenta: uma ação que o servidor não publicou não
 * vira botão, nem "para facilitar".
 *
 * Nenhuma delas executa nada por si. `START_SERVICE_ORDER` **prepara** um
 * atendimento — o formulário abre preenchido e alguém precisa confirmar.
 */
export const FIELD_ACTIONS: Readonly<
  Record<EquipmentFieldAction, QrPresentation>
> = {
  VIEW_DETAILS: {
    label: "Abrir equipamento",
    tone: "neutral",
    description: "Ficha completa, histórico e indicadores.",
  },
  VIEW_HISTORY: {
    label: "Ver histórico",
    tone: "neutral",
    description: "Atendimentos já realizados neste equipamento.",
  },
  START_SERVICE_ORDER: {
    label: "Preparar atendimento",
    tone: "info",
    description: "Abre o formulário preenchido. Nada é criado sem confirmação.",
  },
  EXECUTE_PMOC: {
    label: "Executar PMOC",
    tone: "info",
    description: "Abre o plano de manutenção preventiva deste equipamento.",
  },
  ADD_TO_RVT: {
    label: "Ver visita técnica",
    tone: "info",
    description: "Abre a visita técnica em andamento deste equipamento.",
  },
};

/* ------------------------------------------------------------------ */
/* Acessores                                                           */
/* ------------------------------------------------------------------ */

const FALLBACK: QrPresentation = { label: "—", tone: "neutral" };

/** Código desconhecido não vira rótulo: decifrar o sistema não é tarefa do usuário. */
export const qrStatus = (value: string | null | undefined): QrPresentation =>
  value ? (QR_STATUS[value] ?? FALLBACK) : FALLBACK;

/**
 * A apresentação de uma ação publicada.
 *
 * Devolve `null` — e não um rótulo genérico — quando o servidor publica uma
 * ação que esta versão da tela ainda não sabe apresentar. Um botão sem nome
 * claro é pior que a ausência dele: convida ao clique sem dizer o que faz.
 */
export const fieldAction = (value: string): QrPresentation | null =>
  FIELD_ACTIONS[value as EquipmentFieldAction] ?? null;

export const labelFormat = (value: string) =>
  LABEL_FORMATS.find((entry) => entry.format === value) ?? null;

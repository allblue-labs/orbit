/**
 * A fila de atribuições esperando autorização, agrupada para o dono decidir.
 *
 * ## Por que agrupar por técnico, e depois por dia
 *
 * Porque é nessa ordem que a decisão acontece. O dono olha a carga de uma pessoa —
 * "o Eduardo tem seis atendimentos esta semana, libero todos" — e às vezes precisa
 * descer um nível: "libero o que é de amanhã e deixo o resto para depois". Uma lista
 * plana ordenada por data obrigaria a caçar as linhas de cada técnico no meio das
 * outras e marcá-las uma a uma.
 *
 * ## O dia é civil, no fuso da unidade
 *
 * `scheduledStart` é um instante; "quarta-feira" não é. Agrupar pelo instante cru
 * colocaria um atendimento das 21h de Recife no dia seguinte, e o dono liberaria
 * "quinta" sem perceber que soltou a noite de quarta.
 *
 * Atendimento sem data vai para um grupo próprio, no fim: ele existe, precisa de
 * autorização, e esconder por falta de data seria tirar da fila quem está nela.
 *
 * ## Os ids viajam prontos
 *
 * Cada grupo publica o conjunto de ids que o botão dele envia. É o que faz a
 * autorização ser do que a tela mostrou — ver `AuthorizeOperationsDto`: um comando
 * do tipo "todas do técnico X" resolveria o conjunto no servidor e liberaria um
 * atendimento criado depois de a tela carregar.
 */
import { zonedParts } from "@/lib/scheduling";

/**
 * O mínimo que a fila precisa de cada atendimento.
 *
 * Um subconjunto estrutural de `OperationListItem`, e não o tipo inteiro: o
 * agrupamento se testa com quatro campos, e exigir o contrato completo obrigaria cada
 * caso de teste a inventar trinta campos que a regra não lê.
 */
export interface ItemDaFila {
  readonly id: string;
  readonly code: string;
  readonly serviceOrderCode?: string | null;
  readonly title: string;
  readonly scheduledStart: string | null;
  readonly responsibleFieldTechnician: {
    readonly id: string;
    readonly displayName: string;
  } | null;
}

export interface GrupoDeDia {
  /** `YYYY-MM-DD` no fuso da unidade, ou `null` quando não há data. */
  readonly dia: string | null;
  readonly itens: readonly ItemDaFila[];
  /** O que o botão do dia envia. */
  readonly ids: readonly string[];
}

export interface GrupoDeTecnico {
  readonly tecnicoId: string;
  readonly tecnico: string;
  readonly dias: readonly GrupoDeDia[];
  /** O que o botão do técnico envia: tudo dele, de todos os dias. */
  readonly ids: readonly string[];
  readonly total: number;
}

/** `YYYY-MM-DD` no fuso informado, ou `null` sem data. */
export function diaCivil(
  scheduledStart: string | null,
  timeZone: string,
): string | null {
  if (!scheduledStart) return null;
  const parts = zonedParts(new Date(scheduledStart), timeZone);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

/**
 * Agrupa a fila por técnico e, dentro dele, por dia.
 *
 * Técnicos em ordem alfabética, porque é como se procura uma pessoa numa lista. Dias
 * em ordem cronológica, com os sem data no fim — o que vem primeiro é o que corre o
 * risco de atrasar.
 *
 * Atendimento sem responsável não entra: ele não é autorizável (o servidor recusa) e
 * não há a quem liberar. A consulta já o exclui; isto é a segunda tranca, para a
 * tela não oferecer um botão que o servidor vai negar.
 */
export function agruparFila(
  itens: readonly ItemDaFila[],
  timeZone: string,
): readonly GrupoDeTecnico[] {
  const porTecnico = new Map<string, { nome: string; itens: ItemDaFila[] }>();

  for (const item of itens) {
    const tecnico = item.responsibleFieldTechnician;
    if (!tecnico) continue;
    const grupo = porTecnico.get(tecnico.id) ?? {
      nome: tecnico.displayName,
      itens: [],
    };
    grupo.itens.push(item);
    porTecnico.set(tecnico.id, grupo);
  }

  return [...porTecnico.entries()]
    .sort(([, esquerda], [, direita]) =>
      esquerda.nome.localeCompare(direita.nome, "pt-BR"),
    )
    .map(([tecnicoId, grupo]) => ({
      tecnicoId,
      tecnico: grupo.nome,
      dias: agruparPorDia(grupo.itens, timeZone),
      ids: grupo.itens.map((item) => item.id),
      total: grupo.itens.length,
    }));
}

function agruparPorDia(
  itens: readonly ItemDaFila[],
  timeZone: string,
): readonly GrupoDeDia[] {
  const porDia = new Map<string, ItemDaFila[]>();
  /* A chave é texto porque `Map` não acha `null` duas vezes como o mesmo grupo se
     ele vier de caminhos diferentes; `"sem-data"` é explícito e ordena sozinho. */
  const SEM_DATA = "sem-data";

  for (const item of itens) {
    const dia = diaCivil(item.scheduledStart, timeZone) ?? SEM_DATA;
    porDia.set(dia, [...(porDia.get(dia) ?? []), item]);
  }

  return [...porDia.entries()]
    .sort(([esquerda], [direita]) => {
      /* Sem data vai para o fim: o que tem dia marcado é o que corre risco de
         atrasar, e é nele que a decisão é urgente. */
      if (esquerda === SEM_DATA) return 1;
      if (direita === SEM_DATA) return -1;
      return esquerda.localeCompare(direita);
    })
    .map(([dia, doDia]) => ({
      dia: dia === SEM_DATA ? null : dia,
      itens: doDia,
      ids: doDia.map((item) => item.id),
    }));
}

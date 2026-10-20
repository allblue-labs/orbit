/**
 * O que a revisão do PMOC afirma, em frases que se conferem.
 *
 * ## Por que a revisão precisava de uma
 *
 * A anterior era sete linhas de `rótulo: valor` seguidas de uma lista de
 * equipamentos com os números das execuções colados por ponto: `1 · 2 · 3 · 4`. Três
 * problemas, e nenhum de estética:
 *
 * 1. **"Execuções: 4" e "Execuções previstas: 48"** não se distinguem pelo nome. Uma
 *    é quantas vezes a equipe vai ao local, a outra é quantos atendimentos de
 *    equipamento isso gera. Quem lê "4" e "48" na mesma lista supõe erro.
 * 2. **As datas estavam no contrato e não na tela.** Cada execução projetada traz
 *    `dueOn`, e a revisão imprimia só o número de ordem — a informação que a pessoa
 *    está ali para conferir ("quando a equipe vai?") era justamente a descartada.
 * 3. **Nada explicava de onde os números vêm.** `48` sem o `4 × 12` ao lado é um
 *    número para aceitar, não para revisar.
 *
 * ## Nada é recalculado aqui
 *
 * Os números vêm do `POST /pmoc/plans/preview`. A aritmética de calendário que
 * satura o fim do mês — seis meses depois de 31 de agosto é 28 de fevereiro — mora
 * no domínio e no banco. Isto só **organiza e nomeia** o que veio, e é por isso que
 * se testa sem rede: o que pode errar é a frase, não a conta.
 */
import type { PmocPreview } from "@/types/pmoc";

/** Uma afirmação da revisão: o rótulo, o valor e por que ele é esse. */
export interface FatoDaRevisao {
  readonly rotulo: string;
  readonly valor: string;
  /** A explicação, quando o número sozinho não se defende. */
  readonly nota?: string;
}

/** `2026-10-07` → `07/10/2026`, sem o fuso puxar o dia. */
export function dataCivil(iso: string): string {
  const [ano, mes, dia] = iso.slice(0, 10).split("-");
  if (!ano || !mes || !dia) return iso;
  return `${dia}/${mes}/${ano}`;
}

/**
 * Os números da programação, com o que cada um significa.
 *
 * `ciclos × equipamentos = execuções` aparece como nota do total: é a conta que
 * transforma três números soltos em uma frase conferível.
 */
export function fatosDaProgramacao(
  projecao: PmocPreview,
): readonly FatoDaRevisao[] {
  const ciclos = projecao.cycleCount;
  const equipamentos = projecao.equipmentCount;

  return [
    {
      rotulo: "Vigência",
      valor: projecao.endsOn
        ? `${dataCivil(projecao.startsOn)} a ${dataCivil(projecao.endsOn)}`
        : `${dataCivil(projecao.startsOn)} — sem prazo final`,
      nota: projecao.endsOn
        ? undefined
        : "Contrato aberto: a projeção mostra as primeiras execuções.",
    },
    {
      rotulo: "Periodicidade",
      valor: projecao.frequency.label,
      nota: "De quanto em quanto tempo a equipe vai ao local.",
    },
    {
      rotulo: "Visitas no período",
      valor: String(ciclos),
      nota:
        ciclos === 1
          ? "Uma visita dentro da vigência."
          : `${ciclos} visitas dentro da vigência.`,
    },
    {
      rotulo: "Equipamentos cobertos",
      valor: String(equipamentos),
      nota: "Cada visita atende todos eles.",
    },
    {
      rotulo: "Atendimentos previstos",
      valor: String(projecao.projectedExecutions),
      /* A conta ao lado do total: é o que separa "revisar" de "aceitar". */
      nota: `${ciclos} ${ciclos === 1 ? "visita" : "visitas"} × ${equipamentos} ${
        equipamentos === 1 ? "equipamento" : "equipamentos"
      }`,
    },
  ];
}

/**
 * As primeiras datas de visita, para a pergunta que a revisão existe para responder.
 *
 * Um limite, porque um contrato de cinco anos projeta sessenta ciclos e a revisão não
 * é a agenda: as primeiras respondem "começa quando e de quanto em quanto", e o resto
 * se vê no plano depois de criado.
 */
export function primeirasVisitas(
  projecao: PmocPreview,
  limite = 6,
): {
  readonly datas: readonly string[];
  readonly restantes: number;
} {
  const ordenados = [...projecao.cycles].sort(
    (esquerda, direita) => esquerda.sequence - direita.sequence,
  );
  return {
    datas: ordenados.slice(0, limite).map((ciclo) => dataCivil(ciclo.dueOn)),
    restantes: Math.max(0, ordenados.length - limite),
  };
}

/**
 * O aviso que a revisão precisa dar antes de alguém clicar em criar.
 *
 * Sem equipamento o plano não projeta nada — é o defeito que encheu o banco de
 * setenta e cinco planos ativos que não mandam ninguém a lugar nenhum. O wizard já
 * impede avançar sem equipamento; isto é a segunda tranca, e é a que a pessoa lê.
 */
export function avisosDaRevisao(
  projecao: PmocPreview,
  unidadesMarcadas: number,
): readonly string[] {
  const avisos: string[] = [];
  if (projecao.equipmentCount === 0) {
    avisos.push(
      "Nenhum equipamento coberto: o plano existiria sem gerar atendimento nenhum.",
    );
  }
  if (projecao.projectedExecutions === 0 && projecao.equipmentCount > 0) {
    avisos.push(
      "A vigência não alcança nenhuma visita. Aumente o prazo ou encurte a periodicidade.",
    );
  }
  if (unidadesMarcadas === 0) {
    avisos.push(
      "Sem unidades marcadas, o relatório sai com o plano mas sem o detalhamento por unidade.",
    );
  }
  return avisos;
}

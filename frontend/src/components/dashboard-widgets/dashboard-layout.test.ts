import { describe, expect, it } from "vitest";

import { organizarPainel } from "./dashboard-layout";
import type { ResolvedDashboardWidget } from "@/types/dashboard";

type W = Pick<ResolvedDashboardWidget, "id" | "size">;

const w = (id: string, size: ResolvedDashboardWidget["size"]): W => ({
  id,
  size,
});

/** As linhas como `id:colunas`, que é o que se quer ler ao conferir arrumação. */
const arrumacao = (widgets: readonly W[]) =>
  organizarPainel(widgets).map((linha) =>
    linha.widgets
      .map((item) => `${item.widget.id}:${item.colunas}`)
      .join(" | "),
  );

/**
 * O painel real, na ordem que o servidor manda.
 *
 * O teste usa esta lista e não widgets inventados porque é esta a arrumação que
 * foi pedida três vezes — e é com widgets reais que ela precisa sair certa.
 */
const PAINEL_REAL: readonly W[] = [
  w("operations-comparative-radar", "MEDIUM"),
  w("executive-kpis", "LARGE"),
  w("attention-center", "FULL"),
  w("financial-health", "LARGE"),
  w("health-score", "MEDIUM"),
  w("operational-trend", "LARGE"),
  w("team-performance", "LARGE"),
  w("recent-activity", "MEDIUM"),
  w("upcoming-events", "MEDIUM"),
  w("orbit-intelligence", "FULL"),
];

describe("organizarPainel", () => {
  /**
   * A arrumação pedida, inteira, numa asserção.
   *
   * Cada linha deste resultado foi pedida em palavras: os Indicadores Executivos ao
   * lado do Radar ocupando o espaço restante; a Saúde Financeira à esquerda com o
   * Índice de Saúde à direita dela; Atividades Recentes e Próximos Eventos um ao
   * lado do outro.
   */
  it("arruma o painel real como foi pedido", () => {
    expect(arrumacao(PAINEL_REAL)).toEqual([
      "operations-comparative-radar:4 | executive-kpis:8",
      "attention-center:12",
      "financial-health:8 | health-score:4",
      "operational-trend:12",
      "team-performance:12",
      "recent-activity:6 | upcoming-events:6",
      "orbit-intelligence:12",
    ]);
  });

  /**
   * O defeito que derrubou as três tentativas anteriores.
   *
   * O resolver do servidor filtra por plano, permissão e módulo. No modelo de
   * colunas, perder o Centro de Atenção fundia dois blocos num só — e aí a Saúde
   * Financeira deixava de dividir a linha com o Índice de Saúde, que ia para baixo
   * dela. O painel mudava de arrumação por causa de um widget que nem aparece.
   */
  it("perder o separador de largura total não reorganiza o resto", () => {
    const semCentroDeAtencao = PAINEL_REAL.filter(
      (widget) => widget.id !== "attention-center",
    );
    expect(arrumacao(semCentroDeAtencao)).toEqual([
      "operations-comparative-radar:4 | executive-kpis:8",
      "financial-health:8 | health-score:4",
      "operational-trend:12",
      "team-performance:12",
      "recent-activity:6 | upcoming-events:6",
      "orbit-intelligence:12",
    ]);
  });

  /** Tirar um do meio emparelha os vizinhos; não embaralha a página. */
  it("perder um widget do meio só muda a linha dele", () => {
    const semTendencia = PAINEL_REAL.filter(
      (widget) => widget.id !== "operational-trend",
    );
    expect(arrumacao(semTendencia)).toEqual([
      "operations-comparative-radar:4 | executive-kpis:8",
      "attention-center:12",
      "financial-health:8 | health-score:4",
      "team-performance:12",
      "recent-activity:6 | upcoming-events:6",
      "orbit-intelligence:12",
    ]);
  });

  describe("as repartições", () => {
    it("estreito e estreito dividem meio a meio", () => {
      expect(arrumacao([w("a", "MEDIUM"), w("b", "MEDIUM")])).toEqual([
        "a:6 | b:6",
      ]);
    });

    /** O largo ocupa o espaço restante, que é o pedido do Indicadores Executivos. */
    it("estreito seguido de largo dá quatro e oito", () => {
      expect(arrumacao([w("a", "MEDIUM"), w("b", "LARGE")])).toEqual([
        "a:4 | b:8",
      ]);
    });

    it("largo seguido de estreito dá oito e quatro", () => {
      expect(arrumacao([w("a", "LARGE"), w("b", "MEDIUM")])).toEqual([
        "a:8 | b:4",
      ]);
    });

    /** Dois gráficos a seis colunas num painel ficam ilegíveis. */
    it("dois largos seguidos ficam um por linha", () => {
      expect(arrumacao([w("a", "LARGE"), w("b", "LARGE")])).toEqual([
        "a:12",
        "b:12",
      ]);
    });

    it("largura total nunca divide a linha", () => {
      expect(arrumacao([w("a", "FULL"), w("b", "MEDIUM")])).toEqual([
        "a:12",
        "b:6",
      ]);
    });

    it("estreito não se emparelha com a faixa seguinte", () => {
      expect(arrumacao([w("a", "MEDIUM"), w("b", "FULL")])).toEqual([
        "a:6",
        "b:12",
      ]);
    });

    /** Doze colunas para um cartão pequeno o deformariam. */
    it("estreito sozinho no fim fica em meia linha", () => {
      expect(arrumacao([w("a", "FULL"), w("b", "SMALL")])).toEqual([
        "a:12",
        "b:6",
      ]);
    });

    it("SMALL conta como estreito", () => {
      expect(arrumacao([w("a", "SMALL"), w("b", "LARGE")])).toEqual([
        "a:4 | b:8",
      ]);
    });
  });

  describe("os limites", () => {
    it("lista vazia não produz linha nenhuma", () => {
      expect(arrumacao([])).toEqual([]);
    });

    it("faixas seguidas não criam linha vazia entre elas", () => {
      expect(arrumacao([w("a", "FULL"), w("b", "FULL")])).toEqual([
        "a:12",
        "b:12",
      ]);
    });

    /** Nada é reordenado: o que muda é onde cada widget cai. */
    it("a ordem do servidor é preservada", () => {
      const ordem = organizarPainel(PAINEL_REAL).flatMap((linha) =>
        linha.widgets.map((item) => item.widget.id),
      );
      expect(ordem).toEqual(PAINEL_REAL.map((widget) => widget.id));
    });

    /** Cada linha fecha em doze colunas, ou em seis quando sobrou um só. */
    it("nenhuma linha passa de doze colunas", () => {
      for (const linha of organizarPainel(PAINEL_REAL)) {
        const total = linha.widgets.reduce(
          (soma, item) => soma + item.colunas,
          0,
        );
        expect(total).toBeLessThanOrEqual(12);
      }
    });

    /** Nenhum widget some, e nenhum aparece duas vezes. */
    it("todo widget entra exatamente uma vez", () => {
      const ids = organizarPainel(PAINEL_REAL).flatMap((linha) =>
        linha.widgets.map((item) => item.widget.id),
      );
      expect(new Set(ids).size).toBe(PAINEL_REAL.length);
    });
  });
});

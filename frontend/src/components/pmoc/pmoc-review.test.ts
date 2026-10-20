import { describe, expect, it } from "vitest";

import {
  avisosDaRevisao,
  dataCivil,
  fatosDaProgramacao,
  primeirasVisitas,
} from "./pmoc-review";
import type { PmocPreview } from "@/types/pmoc";

const projecao = (patch: Partial<PmocPreview> = {}): PmocPreview =>
  ({
    customer: { id: "c1", name: "Padaria Aurora" },
    timezone: "America/Recife",
    startsOn: "2026-01-01",
    endsOn: "2026-12-31",
    frequency: { amount: 3, unit: "MONTHS", label: "a cada 3 meses" },
    cycles: [
      { sequence: 1, dueOn: "2026-01-01" },
      { sequence: 2, dueOn: "2026-04-01" },
      { sequence: 3, dueOn: "2026-07-01" },
      { sequence: 4, dueOn: "2026-10-01" },
    ],
    cycleCount: 4,
    truncated: false,
    equipmentCount: 12,
    matrix: [],
    projectedExecutions: 48,
    ...patch,
  }) as PmocPreview;

const fato = (projection: PmocPreview, rotulo: string) =>
  fatosDaProgramacao(projection).find((item) => item.rotulo === rotulo);

describe("a data civil", () => {
  /**
   * `2026-10-07` é um dia, não um instante.
   *
   * `new Date("2026-10-07")` é meia-noite UTC e, num fuso negativo, imprime 06/10 —
   * o mesmo erro que já apareceu no período dos relatórios.
   */
  it("não deixa o fuso puxar o dia", () => {
    expect(dataCivil("2026-10-07")).toBe("07/10/2026");
  });

  it("aceita um instante completo e usa só a data", () => {
    expect(dataCivil("2026-10-07T23:00:00.000Z")).toBe("07/10/2026");
  });

  it("texto que não é data volta como veio, em vez de virar NaN", () => {
    expect(dataCivil("sem data")).toBe("sem data");
  });
});

describe("os fatos da programação", () => {
  /**
   * O defeito central da revisão anterior.
   *
   * "Execuções: 4" e "Execuções previstas: 48" não se distinguiam pelo nome, e quem
   * lia os dois na mesma lista supunha erro. Agora cada um diz o que é.
   */
  it("separa visitas de atendimentos, pelo nome", () => {
    expect(fato(projecao(), "Visitas no período")?.valor).toBe("4");
    expect(fato(projecao(), "Atendimentos previstos")?.valor).toBe("48");
  });

  /** `48` sem o `4 × 12` ao lado é número para aceitar, não para revisar. */
  it("mostra a conta que produz o total", () => {
    expect(fato(projecao(), "Atendimentos previstos")?.nota).toBe(
      "4 visitas × 12 equipamentos",
    );
  });

  it("a conta concorda no singular", () => {
    const uma = projecao({
      cycleCount: 1,
      equipmentCount: 1,
      projectedExecutions: 1,
    });
    expect(fato(uma, "Atendimentos previstos")?.nota).toBe(
      "1 visita × 1 equipamento",
    );
    expect(fato(uma, "Visitas no período")?.nota).toBe(
      "Uma visita dentro da vigência.",
    );
  });

  it("a vigência sai em datas civis", () => {
    expect(fato(projecao(), "Vigência")?.valor).toBe("01/01/2026 a 31/12/2026");
  });

  /** Contrato aberto não imprime "a null": ele diz que é aberto. */
  it("vigência sem fim se explica", () => {
    const aberta = projecao({ endsOn: null });
    expect(fato(aberta, "Vigência")?.valor).toBe(
      "01/01/2026 — sem prazo final",
    );
    expect(fato(aberta, "Vigência")?.nota).toContain("Contrato aberto");
  });

  /** A periodicidade vem pronta do servidor: a tela não a remonta. */
  it("a periodicidade é o rótulo do servidor", () => {
    expect(fato(projecao(), "Periodicidade")?.valor).toBe("a cada 3 meses");
  });
});

describe("as primeiras visitas", () => {
  /**
   * A informação que a revisão existe para dar.
   *
   * A versão anterior imprimia o número de ordem das execuções — `1 · 2 · 3 · 4` —
   * e descartava `dueOn`, que é justamente "quando a equipe vai".
   */
  it("traz as datas, e não os números de ordem", () => {
    expect(primeirasVisitas(projecao()).datas).toEqual([
      "01/01/2026",
      "01/04/2026",
      "01/07/2026",
      "01/10/2026",
    ]);
  });

  it("ordena pela sequência, não pela ordem de chegada", () => {
    const foraDeOrdem = projecao({
      cycles: [
        { sequence: 2, dueOn: "2026-04-01" },
        { sequence: 1, dueOn: "2026-01-01" },
      ],
      cycleCount: 2,
    });
    expect(primeirasVisitas(foraDeOrdem).datas).toEqual([
      "01/01/2026",
      "01/04/2026",
    ]);
  });

  /** Um contrato de cinco anos projeta sessenta ciclos; a revisão não é a agenda. */
  it("limita e diz quantas ficaram de fora", () => {
    const resultado = primeirasVisitas(projecao(), 2);
    expect(resultado.datas).toHaveLength(2);
    expect(resultado.restantes).toBe(2);
  });

  it("dentro do limite, nada fica de fora", () => {
    expect(primeirasVisitas(projecao(), 10).restantes).toBe(0);
  });

  it("sem ciclo nenhum, nenhuma data", () => {
    const vazia = projecao({ cycles: [], cycleCount: 0 });
    expect(primeirasVisitas(vazia)).toEqual({ datas: [], restantes: 0 });
  });
});

describe("os avisos", () => {
  it("plano sem equipamento é avisado", () => {
    const semEquipamento = projecao({
      equipmentCount: 0,
      projectedExecutions: 0,
    });
    expect(avisosDaRevisao(semEquipamento, 1)[0]).toContain(
      "Nenhum equipamento coberto",
    );
  });

  /**
   * Vigência curta demais para a periodicidade.
   *
   * Trimestral num contrato de um mês projeta zero visitas: o plano existiria e
   * nunca mandaria ninguém. É um erro de parâmetro, e a revisão é onde ele aparece.
   */
  it("vigência que não alcança visita é avisada", () => {
    const semVisita = projecao({
      cycleCount: 0,
      projectedExecutions: 0,
      cycles: [],
    });
    expect(
      avisosDaRevisao(semVisita, 1).some((aviso) =>
        aviso.includes("vigência não alcança"),
      ),
    ).toBe(true);
  });

  it("sem unidades marcadas, avisa o que o relatório perde", () => {
    expect(
      avisosDaRevisao(projecao(), 0).some((aviso) =>
        aviso.includes("detalhamento por unidade"),
      ),
    ).toBe(true);
  });

  it("plano completo não produz aviso", () => {
    expect(avisosDaRevisao(projecao(), 2)).toEqual([]);
  });
});

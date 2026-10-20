import { describe, expect, it } from "vitest";

import { agruparFila, diaCivil, type ItemDaFila } from "./authorization-queue";

const RECIFE = "America/Recife";

const item = (
  id: string,
  tecnico: { id: string; displayName: string } | null,
  scheduledStart: string | null = null,
): ItemDaFila => ({
  id,
  code: `OS-${id}`,
  title: `Atendimento ${id}`,
  scheduledStart,
  responsibleFieldTechnician: tecnico,
});

const ana = { id: "ana", displayName: "Ana Souza" };
const bruno = { id: "bruno", displayName: "Bruno Lima" };

describe("o dia civil da fila", () => {
  /**
   * O instante não é o dia.
   *
   * 21h de Recife é 00h do dia seguinte em UTC. Agrupar pelo instante cru faria o
   * dono liberar "quinta" e soltar a noite de quarta sem perceber.
   */
  it("usa o fuso da unidade, não UTC", () => {
    expect(diaCivil("2026-10-08T00:30:00.000Z", RECIFE)).toBe("2026-10-07");
  });

  it("o mesmo instante em UTC cai no dia de UTC", () => {
    expect(diaCivil("2026-10-08T00:30:00.000Z", "UTC")).toBe("2026-10-08");
  });

  it("sem data, não há dia", () => {
    expect(diaCivil(null, RECIFE)).toBeNull();
  });
});

describe("o agrupamento da fila", () => {
  it("agrupa por técnico, em ordem alfabética", () => {
    const grupos = agruparFila([item("1", bruno), item("2", ana)], RECIFE);
    expect(grupos.map((grupo) => grupo.tecnico)).toEqual([
      "Ana Souza",
      "Bruno Lima",
    ]);
  });

  /** O botão do técnico envia tudo dele, de todos os dias. */
  it("o técnico publica os ids de todos os dias dele", () => {
    const grupos = agruparFila(
      [
        item("1", ana, "2026-10-07T13:00:00.000Z"),
        item("2", ana, "2026-10-09T13:00:00.000Z"),
      ],
      RECIFE,
    );
    expect(grupos[0]!.ids).toEqual(["1", "2"]);
    expect(grupos[0]!.total).toBe(2);
  });

  it("dentro do técnico, agrupa por dia em ordem cronológica", () => {
    const grupos = agruparFila(
      [
        item("depois", ana, "2026-10-09T13:00:00.000Z"),
        item("antes", ana, "2026-10-07T13:00:00.000Z"),
      ],
      RECIFE,
    );
    expect(grupos[0]!.dias.map((dia) => dia.dia)).toEqual([
      "2026-10-07",
      "2026-10-09",
    ]);
  });

  it("o botão do dia envia só o daquele dia", () => {
    const grupos = agruparFila(
      [
        item("manha", ana, "2026-10-07T11:00:00.000Z"),
        item("tarde", ana, "2026-10-07T18:00:00.000Z"),
        item("outro-dia", ana, "2026-10-09T13:00:00.000Z"),
      ],
      RECIFE,
    );
    const [primeiro] = grupos[0]!.dias;
    expect(primeiro!.ids).toEqual(["manha", "tarde"]);
  });

  /**
   * Sem data vai para o fim.
   *
   * O que tem dia marcado é o que corre risco de atrasar, e é nele que a decisão é
   * urgente. Mas esconder o sem data tiraria da fila quem está nela.
   */
  it("o sem data fica no fim, e não desaparece", () => {
    const grupos = agruparFila(
      [
        item("sem-data", ana, null),
        item("com-data", ana, "2026-10-07T13:00:00.000Z"),
      ],
      RECIFE,
    );
    expect(grupos[0]!.dias.map((dia) => dia.dia)).toEqual(["2026-10-07", null]);
    expect(grupos[0]!.total).toBe(2);
  });

  /**
   * O sem data desce qualquer que seja a ordem de chegada.
   *
   * O comparador tem dois ramos — sem data à esquerda e à direita — e com dois grupos
   * o motor só chama um deles. Invertendo a ordem de inserção, o outro ramo é
   * exercitado; sem este caso, metade da regra ficava sem teste.
   */
  it("o sem data desce mesmo chegando depois", () => {
    const grupos = agruparFila(
      [
        item("com-data", ana, "2026-10-07T13:00:00.000Z"),
        item("sem-data", ana, null),
      ],
      RECIFE,
    );
    expect(grupos[0]!.dias.map((dia) => dia.dia)).toEqual(["2026-10-07", null]);
  });

  /** Com três grupos, os dois ramos do comparador agem na mesma ordenação. */
  it("ordena três grupos com o sem data no fim", () => {
    const grupos = agruparFila(
      [
        item("sem", ana, null),
        item("tarde", ana, "2026-10-09T13:00:00.000Z"),
        item("cedo", ana, "2026-10-07T13:00:00.000Z"),
      ],
      RECIFE,
    );
    expect(grupos[0]!.dias.map((dia) => dia.dia)).toEqual([
      "2026-10-07",
      "2026-10-09",
      null,
    ]);
  });

  /**
   * Atendimento sem responsável não entra.
   *
   * Não é autorizável — o servidor recusa — e não há a quem liberar. A consulta já o
   * exclui; isto evita a tela oferecer um botão que o servidor vai negar.
   */
  it("descarta atendimento sem responsável", () => {
    const grupos = agruparFila([item("orfao", null), item("ok", ana)], RECIFE);
    expect(grupos).toHaveLength(1);
    expect(grupos[0]!.ids).toEqual(["ok"]);
  });

  it("fila vazia não produz grupo", () => {
    expect(agruparFila([], RECIFE)).toEqual([]);
  });

  /** O mesmo técnico em dois dias é um grupo, não dois. */
  it("não duplica o técnico", () => {
    const grupos = agruparFila(
      [
        item("1", ana, "2026-10-07T13:00:00.000Z"),
        item("2", ana, "2026-10-09T13:00:00.000Z"),
      ],
      RECIFE,
    );
    expect(grupos).toHaveLength(1);
    expect(grupos[0]!.dias).toHaveLength(2);
  });

  /** Nenhum id se perde nem se repete entre os grupos de dia. */
  it("os ids do técnico são a soma exata dos dias", () => {
    const grupos = agruparFila(
      [
        item("a", ana, "2026-10-07T13:00:00.000Z"),
        item("b", ana, "2026-10-09T13:00:00.000Z"),
        item("c", ana, null),
        item("d", bruno, "2026-10-07T13:00:00.000Z"),
      ],
      RECIFE,
    );
    for (const grupo of grupos) {
      const dosDias = grupo.dias.flatMap((dia) => dia.ids);
      expect([...dosDias].sort()).toEqual([...grupo.ids].sort());
      expect(new Set(dosDias).size).toBe(dosDias.length);
    }
  });
});

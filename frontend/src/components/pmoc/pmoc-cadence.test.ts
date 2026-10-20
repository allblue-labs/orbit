import { describe, expect, it } from "vitest";

import {
  CADENCIAS,
  cadenciaDoIntervalo,
  descricaoDaCadencia,
  descricaoDoIntervalo,
  intervaloDaCadencia,
} from "./pmoc-cadence";
import { PmocFrequencyUnit } from "@/types/contracts";

describe("as cadências do PMOC", () => {
  /** O caso que motivou tudo: trimestral precisa ser dizível por nome. */
  it("trimestral é de três em três meses", () => {
    expect(intervaloDaCadencia("TRIMESTRAL")).toEqual({
      amount: 3,
      unit: PmocFrequencyUnit.MONTHS,
    });
  });

  it("semestral é de seis em seis meses", () => {
    expect(intervaloDaCadencia("SEMESTRAL")).toEqual({
      amount: 6,
      unit: PmocFrequencyUnit.MONTHS,
    });
  });

  it("anual é uma vez por ano, e não doze meses", () => {
    /* `1 YEARS` e `12 MONTHS` dariam as mesmas datas na maioria dos casos, mas ano é
       a unidade que o contrato usa — e é ela que o servidor resolve por calendário. */
    expect(intervaloDaCadencia("ANUAL")).toEqual({
      amount: 1,
      unit: PmocFrequencyUnit.YEARS,
    });
  });

  it("personalizada não tem intervalo próprio", () => {
    expect(intervaloDaCadencia("PERSONALIZADA")).toBeNull();
  });

  describe("o caminho de volta", () => {
    /** Um plano já gravado abre no nome da periodicidade, não em "Personalizada". */
    it.each(CADENCIAS)("$label volta a ser $key", (cadencia) => {
      expect(cadenciaDoIntervalo(cadencia.amount, cadencia.unit)).toBe(
        cadencia.key,
      );
    });

    it("um par que nenhum nome descreve é personalizado", () => {
      expect(cadenciaDoIntervalo(45, PmocFrequencyUnit.DAYS)).toBe(
        "PERSONALIZADA",
      );
    });

    /** A unidade conta: duas semanas é quinzenal, dois meses é bimestral. */
    it("a unidade distingue cadências de mesmo número", () => {
      expect(cadenciaDoIntervalo(2, PmocFrequencyUnit.WEEKS)).toBe("QUINZENAL");
      expect(cadenciaDoIntervalo(2, PmocFrequencyUnit.MONTHS)).toBe(
        "BIMESTRAL",
      );
    });
  });

  describe("o catálogo", () => {
    /** Duas cadências com o mesmo par tornariam o caminho de volta ambíguo. */
    it("nenhum par se repete", () => {
      const pares = CADENCIAS.map((item) => `${item.amount}:${item.unit}`);
      expect(new Set(pares).size).toBe(pares.length);
    });

    it("toda cadência tem intervalo de pelo menos um", () => {
      for (const cadencia of CADENCIAS) {
        expect(cadencia.amount).toBeGreaterThanOrEqual(1);
      }
    });

    /** Do mais frequente para o menos: é a ordem em que se pensa um contrato. */
    it("está ordenada do intervalo mais curto para o mais longo", () => {
      const emDias: Readonly<Record<string, number>> = {
        DAYS: 1,
        WEEKS: 7,
        MONTHS: 30,
        YEARS: 365,
      };
      const duracoes = CADENCIAS.map(
        (item) => item.amount * emDias[item.unit]!,
      );
      expect([...duracoes]).toEqual([...duracoes].sort((a, b) => a - b));
    });
  });

  describe("a frase da periodicidade", () => {
    it("a cadência nomeada usa a frase dela", () => {
      expect(
        descricaoDaCadencia("TRIMESTRAL", 3, PmocFrequencyUnit.MONTHS),
      ).toBe("a cada três meses");
    });

    /** Personalizada descreve o par cru, porque é tudo o que se sabe dele. */
    it("personalizada descreve o intervalo", () => {
      expect(
        descricaoDaCadencia("PERSONALIZADA", 45, PmocFrequencyUnit.DAYS),
      ).toBe("a cada 45 dias");
    });

    /** "a cada 1 dias" é o tipo de detalhe que faz a tela parecer rascunho. */
    it("concorda em número", () => {
      expect(descricaoDoIntervalo(1, PmocFrequencyUnit.DAYS)).toBe(
        "a cada 1 dia",
      );
      expect(descricaoDoIntervalo(2, PmocFrequencyUnit.DAYS)).toBe(
        "a cada 2 dias",
      );
      expect(descricaoDoIntervalo(1, PmocFrequencyUnit.MONTHS)).toBe(
        "a cada 1 mês",
      );
      expect(descricaoDoIntervalo(3, PmocFrequencyUnit.MONTHS)).toBe(
        "a cada 3 meses",
      );
    });

    /** Campo vazio não vira "a cada NaN dias" na tela. */
    it("intervalo inválido não produz frase quebrada", () => {
      expect(descricaoDoIntervalo(Number.NaN, PmocFrequencyUnit.DAYS)).toBe(
        "intervalo não definido",
      );
      expect(descricaoDoIntervalo(0, PmocFrequencyUnit.MONTHS)).toBe(
        "intervalo não definido",
      );
    });
  });
});

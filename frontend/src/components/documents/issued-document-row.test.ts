import { describe, expect, it } from "vitest";

import {
  hasRevisionHistory,
  issuedDocumentHref,
  issuedDocumentIdentity,
  issuedDocumentTypeLabel,
} from "./issued-document-row";
import type { IssuedDocument } from "@/types/issued-documents";

const base: IssuedDocument = {
  source: "EXECUTION",
  id: "exec-1",
  code: "PMOC-0031",
  title: "PMOC Padaria Aurora",
  type: "PMOC",
  renderStatus: "READY",
  status: "COMPLETED",
  businessUnitId: "unit",
  customerId: "cliente",
  operationId: "operacao",
  createdAt: "2026-03-10T12:00:00.000Z",
  issuedAt: "2026-03-11T12:00:00.000Z",
  revisions: 1,
  periodFrom: null,
  periodTo: null,
};

const report = (patch: Partial<IssuedDocument> = {}): IssuedDocument => ({
  ...base,
  source: "REPORT",
  id: "report-1",
  code: null,
  title: null,
  type: "OPERATIONAL_SUMMARY",
  status: "READY",
  customerId: null,
  operationId: null,
  periodFrom: "2026-03-01T00:00:00.000Z",
  periodTo: "2026-03-31T23:59:59.999Z",
  ...patch,
});

describe("a linha da central de documentos", () => {
  describe("o tipo", () => {
    it("a execução usa o registro local de tipos de artefato", () => {
      expect(issuedDocumentTypeLabel(base)).toBe("PMOC");
    });

    it("o relatório usa o catálogo do servidor", () => {
      expect(
        issuedDocumentTypeLabel(report(), {
          OPERATIONAL_SUMMARY: "Resumo operacional",
        }),
      ).toBe("Resumo operacional");
    });

    /**
     * Tipo desconhecido aparece cru.
     *
     * Um valor novo publicado pelo backend deve ser legível antes de alguém
     * atualizar o registro — virar "—" esconderia que ele existe.
     */
    it("tipo de relatório fora do catálogo aparece cru", () => {
      expect(issuedDocumentTypeLabel(report({ type: "NOVO_TIPO" }))).toBe(
        "NOVO_TIPO",
      );
    });
  });

  describe("a identidade da execução", () => {
    it("mostra o título em cima e o código embaixo", () => {
      const identidade = issuedDocumentIdentity(base);
      expect(identidade.primary).toBe("PMOC Padaria Aurora");
      expect(identidade.secondary).toBe("PMOC-0031");
      expect(identidade.secondaryIsCode).toBe(true);
    });

    /** Sem título, a linha não pode ficar invisível: o código assume o lugar. */
    it("sem título, o código sobe para a primeira linha", () => {
      const identidade = issuedDocumentIdentity({ ...base, title: null });
      expect(identidade.primary).toBe("PMOC-0031");
      expect(identidade.secondary).toBeNull();
    });

    it("título em branco conta como sem título", () => {
      const identidade = issuedDocumentIdentity({ ...base, title: "   " });
      expect(identidade.primary).toBe("PMOC-0031");
    });

    /** Nem título nem código ainda produz algo legível. */
    it("sem título e sem código, diz que não tem título", () => {
      const identidade = issuedDocumentIdentity({
        ...base,
        title: null,
        code: null,
      });
      expect(identidade.primary).toBe("Sem título");
    });
  });

  describe("a identidade do relatório", () => {
    /**
     * É o período que responde "qual relatório é este".
     *
     * O mesmo tipo é gerado todo mês: sem o período, doze linhas idênticas.
     */
    it("mostra o tipo em cima e o período embaixo", () => {
      const identidade = issuedDocumentIdentity(report(), {
        OPERATIONAL_SUMMARY: "Resumo operacional",
      });
      expect(identidade.primary).toBe("Resumo operacional");
      expect(identidade.secondary).toBe("01/03/2026 a 31/03/2026");
      expect(identidade.secondaryIsCode).toBe(false);
    });

    it("período que cruza meses mostra as duas pontas", () => {
      const identidade = issuedDocumentIdentity(
        report({
          periodFrom: "2026-01-01T00:00:00.000Z",
          periodTo: "2026-03-31T23:59:59.999Z",
        }),
      );
      expect(identidade.secondary).toBe("01/01/2026 a 31/03/2026");
    });

    /**
     * O formato é injetável, e o padrão é o da casa.
     *
     * Quem chama passa o formatador da tela; este teste passa o seu para provar
     * que são as duas pontas do período que entram na frase, e nessa ordem — sem
     * isso a asserção mediria o `Intl` do ambiente.
     */
    it("usa o formatador que recebe, com as duas pontas na ordem", () => {
      const identidade = issuedDocumentIdentity(
        report(),
        {},
        (from, to) => `${from.slice(0, 10)}→${to.slice(0, 10)}`,
      );
      expect(identidade.secondary).toBe("2026-03-01→2026-03-31");
    });

    it("sem período, não inventa segunda linha", () => {
      const identidade = issuedDocumentIdentity(
        report({ periodFrom: null, periodTo: null }),
      );
      expect(identidade.secondary).toBeNull();
    });
  });

  describe("o destino", () => {
    /** Mandar as duas origens para o mesmo lugar daria 404 em metade das linhas. */
    it("execução abre a tela da execução", () => {
      expect(issuedDocumentHref(base)).toBe("/execucoes/exec-1");
    });

    it("relatório abre a página do relatório", () => {
      expect(issuedDocumentHref(report())).toBe("/relatorios/report-1");
    });
  });

  describe("o histórico de revisões", () => {
    /** O visualizador lê manifestos, e relatório gerencial não tem manifesto. */
    it("só a execução tem revisões para folhear", () => {
      expect(hasRevisionHistory(base)).toBe(true);
      expect(hasRevisionHistory(report())).toBe(false);
    });
  });
});

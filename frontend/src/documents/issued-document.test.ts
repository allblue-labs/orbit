/**
 * Baixar e compartilhar um documento emitido.
 *
 * O que se prova aqui é o que decide sem tela: qual revisão se entrega, se a
 * ação aparece, como o arquivo se chama, e o que fazer com cada desfecho do
 * compartilhamento.
 */
import { describe, expect, it } from "vitest";

import {
  isDocumentIssued,
  issuedFileName,
  pickIssuedManifest,
  shareOutcomeOf,
  shareSupport,
} from "./issued-document";
import type { ArtifactManifestSummary } from "@/types/documents";

const revisao = (
  campos: Partial<ArtifactManifestSummary>,
): ArtifactManifestSummary =>
  ({
    id: "m",
    revision: 1,
    status: "ISSUED",
    isActive: true,
    contentHash: "a".repeat(64),
    ...campos,
  }) as ArtifactManifestSummary;

describe("revisão entregue", () => {
  it("entrega a ativa e emitida", () => {
    const lista = [
      revisao({ id: "antiga", revision: 1, isActive: false, status: "SUPERSEDED" }),
      revisao({ id: "atual", revision: 2 }),
    ];

    expect(pickIssuedManifest(lista)?.id).toBe("atual");
  });

  /** Emitida sem conteúdo é registro sem arquivo. */
  it("não entrega revisão sem arquivo", () => {
    expect(pickIssuedManifest([revisao({ contentHash: null })])).toBeNull();
  });

  it("não entrega rascunho nem revogada", () => {
    expect(
      pickIssuedManifest([
        revisao({ status: "DRAFT" }),
        revisao({ status: "REVOKED" }),
      ]),
    ).toBeNull();
  });

  it("não entrega a emitida que deixou de ser ativa", () => {
    expect(pickIssuedManifest([revisao({ isActive: false })])).toBeNull();
  });

  it("entre ativas, a revisão mais alta", () => {
    expect(
      pickIssuedManifest([
        revisao({ id: "r2", revision: 2 }),
        revisao({ id: "r5", revision: 5 }),
        revisao({ id: "r3", revision: 3 }),
      ])?.id,
    ).toBe("r5");
  });
});

describe("a ação aparece", () => {
  it("só para documento emitido", () => {
    expect(isDocumentIssued("READY")).toBe(true);
    for (const estado of ["NOT_RENDERED", "PENDING", "RENDERING", "FAILED"]) {
      expect(isDocumentIssued(estado), estado).toBe(false);
    }
  });

  /* O estado da execução não é o do documento: `COMPLETED` é preenchimento
     concluído, não arquivo emitido. Foi a confusão do recibo "Rascunho". */
  it("o COMPLETED da execução não conta como emitido", () => {
    expect(isDocumentIssued("COMPLETED")).toBe(false);
  });

  it("sem estado, não aparece", () => {
    expect(isDocumentIssued(null)).toBe(false);
    expect(isDocumentIssued(undefined)).toBe(false);
  });
});

describe("nome do arquivo", () => {
  it("leva o código e o título", () => {
    expect(
      issuedFileName(
        { code: "OS-000072", title: "Clínica Sol" },
        "application/pdf",
      ),
    ).toBe("OS-000072 - Clínica Sol.pdf");
  });

  /** O nome é lido por gente: acento fica, o que o disco recusa sai. */
  it("tira o que o sistema de arquivos recusa e mantém acentos", () => {
    expect(
      issuedFileName(
        { code: "REC-1", title: 'Pagamento: "março/2026"' },
        "application/pdf",
      ),
    ).toBe("REC-1 - Pagamento março 2026.pdf");
  });

  it("sem código nem título, ainda tem nome", () => {
    expect(issuedFileName({}, "application/pdf")).toBe("documento.pdf");
  });

  it("a extensão segue o tipo do arquivo", () => {
    expect(issuedFileName({ code: "X" }, "text/html; charset=utf-8")).toBe(
      "X.html",
    );
  });

  it("tipo desconhecido vira pdf, que é o que o produto emite", () => {
    expect(issuedFileName({ code: "X" }, "")).toBe("X.pdf");
  });

  it("título enorme é cortado", () => {
    const nome = issuedFileName({ title: "a".repeat(400) }, "application/pdf");
    expect(nome.length).toBeLessThanOrEqual(124);
  });
});

describe("o navegador compartilha arquivo?", () => {
  const arquivo = new File(["x"], "doc.pdf", { type: "application/pdf" });

  it("compartilha quando aceita arquivos", () => {
    expect(
      shareSupport(
        { share: async () => {}, canShare: () => true } as never,
        arquivo,
      ),
    ).toBe("files");
  });

  /**
   * Ter `share` não basta: vários navegadores compartilham texto e recusam
   * arquivo. Quem responde "não" recebe o download.
   */
  it("não compartilha quando recusa arquivo", () => {
    expect(
      shareSupport(
        { share: async () => {}, canShare: () => false } as never,
        arquivo,
      ),
    ).toBe("none");
  });

  it("sem canShare, não arrisca", () => {
    expect(shareSupport({ share: async () => {} } as never, arquivo)).toBe(
      "none",
    );
  });

  it("sem share nenhum, baixa", () => {
    expect(shareSupport(undefined, arquivo)).toBe("none");
  });

  it("canShare que lança não derruba a ação", () => {
    expect(
      shareSupport(
        {
          share: async () => {},
          canShare: () => {
            throw new TypeError("x");
          },
        } as never,
        arquivo,
      ),
    ).toBe("none");
  });
});

describe("desfecho do compartilhamento", () => {
  /** Fechar a folha é decisão de quem tocou, não erro. */
  it("cancelar não é falha", () => {
    expect(shareOutcomeOf(new DOMException("x", "AbortError"))).toBe(
      "cancelled",
    );
  });

  /**
   * O navegador só abre a folha logo após um gesto, e buscar o arquivo pode
   * passar do limite. Isso pede um segundo toque, não uma mensagem de erro.
   */
  it("perder o gesto pede um segundo toque", () => {
    expect(shareOutcomeOf(new DOMException("x", "NotAllowedError"))).toBe(
      "activation",
    );
  });

  it("o resto é falha", () => {
    expect(shareOutcomeOf(new Error("x"))).toBe("failed");
    expect(shareOutcomeOf("x")).toBe("failed");
  });
});

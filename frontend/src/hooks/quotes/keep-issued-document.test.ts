/**
 * O documento emitido não some da tela depois de um comando.
 *
 * A resposta de enviar, aprovar ou converter não relê o documento — vem com
 * `document: null`. Gravá-la crua no cache apagaria o "Baixar" que estava na
 * tela segundos antes.
 */
import { describe, expect, it } from "vitest";

import type { Quote } from "@/types/quotes";
import { keepIssuedDocument } from "./use-quotes";

const documento = {
  executionId: "exec-1",
  code: "ORC-000001",
  title: "Orçamento ORC-000001",
  renderStatus: "READY",
};

const proposta = (campos: Partial<Quote>) =>
  ({ id: "q1", status: "APPROVED", document: null, ...campos }) as Quote;

describe("keepIssuedDocument", () => {
  it("mantém o documento que o cache conhecia quando a resposta não o traz", () => {
    const resultado = keepIssuedDocument(
      proposta({ status: "SENT", document: documento }),
      proposta({ status: "APPROVED" }),
    );

    expect(resultado.document).toEqual(documento);
    expect(resultado.status).toBe("APPROVED");
  });

  it("prefere o documento da resposta quando ela o traz", () => {
    const novo = { ...documento, executionId: "exec-2" };

    expect(
      keepIssuedDocument(
        proposta({ document: documento }),
        proposta({ document: novo }),
      ).document,
    ).toEqual(novo);
  });

  it("sem cache e sem documento, continua sem documento", () => {
    expect(keepIssuedDocument(undefined, proposta({})).document).toBeNull();
  });
});

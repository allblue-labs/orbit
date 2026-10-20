/**
 * As duas decisões da página pública.
 *
 * O que está protegido não é "a página renderiza": é que um contratante que assinou
 * com sucesso não veja uma tela de erro, e que um clique duplo não tente assinar duas
 * vezes.
 */
import { describe, expect, it } from "vitest";

import {
  assinaturaFoiRegistrada,
  etapaDoContrato,
  podeAssinar,
} from "./contract-signing.model";

describe("etapaDoContrato", () => {
  it("link válido abre o formulário", () => {
    expect(etapaDoContrato("VALIDO")).toBe("ASSINAR");
  });

  it("contrato já assinado é desfecho, não recusa", () => {
    /* A asserção central deste arquivo. `RECUSADO` aqui mandaria quem acabou de
       assinar pedir outro link — e assinar de novo. */
    expect(etapaDoContrato("JA_ASSINADO")).toBe("CONCLUIDO");
  });

  it("expirado e revogado recusam", () => {
    expect(etapaDoContrato("EXPIRADO")).toBe("RECUSADO");
    expect(etapaDoContrato("REVOGADO")).toBe("RECUSADO");
  });
});

describe("podeAssinar", () => {
  const base = { signerName: "Maria Souza", temTraco: true, enviando: false };

  it("nome e traço bastam", () => {
    expect(podeAssinar(base)).toBe(true);
  });

  it("sem traço não assina", () => {
    expect(podeAssinar({ ...base, temTraco: false })).toBe(false);
  });

  it("sem nome não assina — a rubrica sozinha não identifica", () => {
    expect(podeAssinar({ ...base, signerName: "" })).toBe(false);
  });

  it("nome só de espaços não conta", () => {
    /* `trim`: `"   ".length >= 3` é verdadeiro, e passaria um nome vazio adiante. */
    expect(podeAssinar({ ...base, signerName: "     " })).toBe(false);
  });

  it("enviando bloqueia o segundo clique", () => {
    /* A rota grava e o serviço não repete. Sem este bloqueio, dois cliques viram
       duas assinaturas, e a segunda responde JA_ASSINADO — uma recusa na cara de
       quem acabou de ter sucesso. */
    expect(podeAssinar({ ...base, enviando: true })).toBe(false);
  });
});

describe("assinaturaFoiRegistrada", () => {
  it("VALIDO é o sucesso", () => {
    expect(assinaturaFoiRegistrada({ state: "VALIDO", reason: null })).toBe(
      true,
    );
  });

  it("recusa com motivo não é sucesso", () => {
    expect(
      assinaturaFoiRegistrada({ state: "JA_ASSINADO", reason: "já assinado" }),
    ).toBe(false);
  });

  it("recusa sem motivo também não é sucesso", () => {
    /*
      A asserção que vale o módulo.

      Este formato — estado de recusa com `reason` nulo — é o que `reason === null`
      confundiria com sucesso, e era produzido de verdade pelo backend antes de
      `INEXISTENTE` virar 404. A tela mostraria "contrato assinado" sem nada gravado.
    */
    expect(assinaturaFoiRegistrada({ state: "EXPIRADO", reason: null })).toBe(
      false,
    );
  });
});

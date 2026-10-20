/**
 * A vigência da assinatura, do lado da interface.
 *
 * A regressão que estes testes trancam: a tela decidia por **status** e o
 * servidor por status **e** fim de período. No trigésimo primeiro dia de
 * avaliação a linha ainda dizia `TRIALING`, a interface concluía "ativa" e
 * liberava os botões — e o servidor respondia `402` a toda escrita. A pessoa
 * clicava em salvar e recebia um erro que a tela não sabia explicar.
 */
import { describe, expect, it } from "vitest";

import { assinaturaVigente } from "./subscription-status";

const AGORA = new Date("2026-09-14T12:00:00.000Z");
const ONTEM = "2026-09-13T12:00:00.000Z";
const AMANHA = "2026-09-15T12:00:00.000Z";

describe("assinaturaVigente", () => {
  it("avaliação em curso libera", () => {
    expect(assinaturaVigente("TRIALING", AMANHA, AGORA)).toBe(true);
  });

  /** O caso que originou tudo isto. */
  it("avaliação vencida não libera, mesmo com o status ainda em TRIALING", () => {
    expect(assinaturaVigente("TRIALING", ONTEM, AGORA)).toBe(false);
  });

  it("ativa e dentro do período libera", () => {
    expect(assinaturaVigente("ACTIVE", AMANHA, AGORA)).toBe(true);
  });

  it("ativa com o período vencido não libera", () => {
    expect(assinaturaVigente("ACTIVE", ONTEM, AGORA)).toBe(false);
  });

  /**
   * Cobrança que falhou mantém o acesso.
   *
   * É quase sempre cartão vencido, e derrubar a operação de campo de uma
   * empresa por isso seria a punição errada para o problema errado — a mesma
   * decisão que o backend toma em `COM_ACESSO`.
   */
  it("PAST_DUE e GRACE_PERIOD continuam liberando apó o período pago", () => {
    expect(assinaturaVigente("PAST_DUE", ONTEM, AGORA)).toBe(true);
    expect(assinaturaVigente("GRACE_PERIOD", ONTEM, AGORA)).toBe(true);
  });

  it("cancelada e suspensa não liberam, mesmo com período no futuro", () => {
    expect(assinaturaVigente("CANCELED", AMANHA, AGORA)).toBe(false);
    expect(assinaturaVigente("SUSPENDED", AMANHA, AGORA)).toBe(false);
    expect(assinaturaVigente("EXPIRED", AMANHA, AGORA)).toBe(false);
  });

  it("status ausente não libera", () => {
    expect(assinaturaVigente(undefined, AMANHA, AGORA)).toBe(false);
  });

  /**
   * Sem período não há o que vencer.
   *
   * São as contas anteriores à cobrança, que nunca tiveram data. Tratar
   * ausência como vencimento trancaria justamente quem está em dia.
   */
  it("sem data de fim, o status manda", () => {
    expect(assinaturaVigente("ACTIVE", null, AGORA)).toBe(true);
    expect(assinaturaVigente("CANCELED", null, AGORA)).toBe(false);
  });

  /**
   * Data ilegível não derruba ninguém.
   *
   * Quem decide de verdade é o servidor; se ele recusar, a escrita volta com
   * `402` e a tela explica. Bloquear aqui por um campo malformado tiraria o
   * acesso de quem está pagando por causa de um erro de serialização.
   */
  it("data inválida não bloqueia", () => {
    expect(assinaturaVigente("ACTIVE", "nem-data-e", AGORA)).toBe(true);
  });
});

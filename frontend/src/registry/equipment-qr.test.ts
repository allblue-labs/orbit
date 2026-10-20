/**
 * O que se testa é **apresentação**, não regra de token.
 *
 * Nenhuma validação de token vive no navegador — não há teste de formato,
 * hash ou expiração porque não existe código que faça isso aqui. O que existe
 * é a tradução do que o servidor publicou, e é ela que precisa de prova.
 */
import { describe, expect, it } from "vitest";

import {
  FIELD_ACTIONS,
  LABEL_CONTENT_TYPES,
  LABEL_FORMATS,
  QR_STATUS,
  fieldAction,
  labelFormat,
  qrStatus,
} from "./equipment-qr";

describe("situação da identidade", () => {
  it("traduz os dois estados que o domínio guarda", () => {
    expect(qrStatus("ACTIVE").label).toBe("Ativa");
    expect(qrStatus("REVOKED").label).toBe("Substituída");
  });

  it("a identidade anterior é 'substituída', não 'sem QR'", () => {
    /**
     * Rotacionar troca a etiqueta atomicamente — o equipamento nunca fica sem
     * identidade. Chamar o estado anterior de "revogado" sugeriria um vazio
     * que o banco não permite existir.
     */
    expect(QR_STATUS.REVOKED!.label).not.toMatch(/revogad|sem qr|ausente/i);
    expect(QR_STATUS.REVOKED!.description).toMatch(/nova identidade/i);
  });

  it("nenhum rótulo é o código cru", () => {
    for (const [code, entry] of Object.entries(QR_STATUS)) {
      expect(entry.label, code).not.toBe(code);
      expect(entry.label, code).not.toMatch(/^[A-Z_]+$/);
    }
  });

  it("código desconhecido vira traço, não o próprio código", () => {
    expect(qrStatus("ALGO_NOVO").label).toBe("—");
    expect(qrStatus(null).label).toBe("—");
  });
});

describe("formatos de etiqueta", () => {
  it("cada formato declara o tipo de conteúdo que deve voltar", () => {
    for (const entry of LABEL_FORMATS) {
      expect(LABEL_CONTENT_TYPES[entry.format]).toBeTruthy();
    }
    expect(LABEL_CONTENT_TYPES.svg).toBe("image/svg+xml");
    expect(LABEL_CONTENT_TYPES.png).toBe("image/png");
    expect(LABEL_CONTENT_TYPES.pdf).toBe("application/pdf");
  });

  it("os três formatos são os que o backend aceita", () => {
    expect(LABEL_FORMATS.map((entry) => entry.format)).toEqual([
      "svg",
      "png",
      "pdf",
    ]);
    expect(labelFormat("jpeg")).toBeNull();
  });
});

describe("ações do contexto resolvido", () => {
  it("toda ação publicada tem rótulo de produto", () => {
    for (const [code, entry] of Object.entries(FIELD_ACTIONS)) {
      expect(entry.label, code).not.toMatch(/^[A-Z_]+$/);
      expect(entry.label, code).not.toContain("_");
    }
  });

  it("preparar atendimento diz que nada é criado sem confirmação", () => {
    /**
     * É a garantia central deste domínio: ler a etiqueta nunca abre nem inicia
     * um atendimento. O texto do botão precisa carregar isso, senão a
     * interface promete um comando que ela não executa.
     */
    const action = FIELD_ACTIONS.START_SERVICE_ORDER;
    expect(action.label).toMatch(/preparar/i);
    expect(action.label).not.toMatch(/iniciar|abrir atendimento|criar/i);
    expect(action.description).toMatch(/confirma/i);
  });

  it("nenhuma ação promete executar em campo pelo navegador", () => {
    for (const entry of Object.values(FIELD_ACTIONS)) {
      expect(entry.label).not.toMatch(/^Iniciar |^Concluir |^Assinar /i);
    }
  });

  it("ação publicada e desconhecida devolve null, não um rótulo genérico", () => {
    /**
     * Um botão sem nome claro é pior que a ausência dele: convida ao clique
     * sem dizer o que faz. Quem não está no mapa simplesmente não aparece.
     */
    expect(fieldAction("ALGUMA_ACAO_NOVA")).toBeNull();
    expect(fieldAction("VIEW_DETAILS")).not.toBeNull();
  });
});

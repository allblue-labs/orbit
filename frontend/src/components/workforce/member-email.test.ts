import { describe, expect, it } from "vitest";

import {
  composeEmail,
  looksLikeEmail,
  organizationDomain,
  sanitizeLocalPart,
  suggestLocalPart,
  localPartOf,
} from "./member-email";

describe("o domínio da organização", () => {
  it("vem do slug, que é o identificador canônico", () => {
    expect(organizationDomain("clima-norte")).toBe("clima-norte.com");
  });

  it("não reslugifica o nome: acento e espaço que escaparem viram hífen", () => {
    /* O slug já é canônico. Se vier com resto de nome — de dado antigo ou de
       importação —, o que sai ainda é um rótulo de domínio válido. */
    expect(organizationDomain("Clímã Nórte")).toBe("clima-norte.com");
    expect(organizationDomain("clima  norte")).toBe("clima-norte.com");
  });

  it("não deixa hífen na ponta", () => {
    /* Rótulo de domínio que começa ou termina em hífen é inválido, e o navegador
       recusaria o endereço sem dizer por quê. */
    expect(organizationDomain("-clima-")).toBe("clima.com");
    expect(organizationDomain("clima--norte")).toBe("clima-norte.com");
  });

  it("corta no limite do rótulo sem deixar hífen", () => {
    const longo = `${"a".repeat(62)}-b`;
    const dominio = organizationDomain(longo);

    expect(dominio).toBe(`${"a".repeat(62)}.com`);
  });

  it("sem slug utilizável, não inventa domínio", () => {
    /* `@.com` seria um endereço que o servidor recusa, e a tela teria composto um
       login impossível. Melhor pedir o endereço inteiro. */
    for (const slug of ["", "   ", "---", "***", null, undefined]) {
      expect(organizationDomain(slug), String(slug)).toBeNull();
    }
  });
});

describe("o nome de entrada sugerido", () => {
  it("junta nome e sobrenome com ponto", () => {
    expect(suggestLocalPart("João", "Silva")).toBe("joao.silva");
  });

  it("tira acento e deixa em minúscula", () => {
    expect(suggestLocalPart("José Antônio", "Gonçalves")).toBe(
      "jose.antonio.goncalves",
    );
  });

  it("descarta preposição", () => {
    /* `joao.da.silva` é mais longo para digitar num celular com uma mão suja de
       graxa, que é onde este login é usado. */
    expect(suggestLocalPart("João", "da Silva")).toBe("joao.silva");
    expect(suggestLocalPart("Maria", "dos Santos")).toBe("maria.santos");
  });

  it("sem nome, não sugere nada", () => {
    expect(suggestLocalPart("", "")).toBe("");
    expect(suggestLocalPart("  ", " ")).toBe("");
  });
});

describe("o que a pessoa digita", () => {
  it("é corrigido, não recusado", () => {
    /* Quem digita "José Antônio" quer `jose.antonio`, não um erro no fim do
       formulário. */
    expect(sanitizeLocalPart("José Antônio")).toBe("jose.antonio");
    expect(sanitizeLocalPart("JOAO")).toBe("joao");
  });

  it("perde o que não cabe em endereço", () => {
    expect(sanitizeLocalPart("joão@silva")).toBe("joaosilva");
    expect(sanitizeLocalPart("jo ão/silva")).toBe("jo.aosilva");
  });

  it("não termina nem começa em separador", () => {
    /* `joao.@clima.com` é inválido, e o erro apareceria só no envio. */
    expect(sanitizeLocalPart(".joao.")).toBe("joao");
    expect(sanitizeLocalPart("joao...silva")).toBe("joao.silva");
  });
});

describe("o endereço montado", () => {
  it("é o nome digitado com o domínio da organização", () => {
    expect(composeEmail("joao.silva", "clima-norte.com")).toBe(
      "joao.silva@clima-norte.com",
    );
  });

  it("corrige o nome no caminho", () => {
    expect(composeEmail("João Silva", "clima-norte.com")).toBe(
      "joao.silva@clima-norte.com",
    );
  });

  it("sem nome ou sem domínio, não monta meio endereço", () => {
    /* Meio endereço passaria pela validação de formulário e falharia no servidor,
       depois de o owner preencher o resto do cadastro. */
    expect(composeEmail("", "clima-norte.com")).toBeNull();
    expect(composeEmail("joao", null)).toBeNull();
  });
});

describe("o endereço livre", () => {
  it("aceita o que parece e-mail", () => {
    expect(looksLikeEmail("ana@empresa.com.br")).toBe(true);
  });

  it("recusa o que claramente não é", () => {
    for (const valor of ["ana", "ana@", "@empresa.com", "ana@empresa", "a b@c.com"]) {
      expect(looksLikeEmail(valor), valor).toBe(false);
    }
  });

  describe("parte local de um campo com o domínio dentro", () => {
    it("corta no primeiro @", () => {
      expect(localPartOf("joao.silva@orbit.com")).toBe("joao.silva");
    });

    it("sem @, o texto inteiro é a parte local", () => {
      /* É o estado de quem começou a digitar e o domínio ainda não foi
         recomposto pelo campo. */
      expect(localPartOf("joao.sil")).toBe("joao.sil");
    });

    it("colar um endereço de outro domínio aproveita só o nome", () => {
      /*
       * A forma do campo é "nome + domínio da organização". Colar
       * `joao@outraempresa.com` e manter o outro domínio contrariaria a
       * escolha que o botão ao lado existe para oferecer.
       */
      expect(localPartOf("joao@outraempresa.com")).toBe("joao");
    });

    it("vazio continua vazio", () => {
      expect(localPartOf("")).toBe("");
      expect(localPartOf("@orbit.com")).toBe("");
    });
  });
});

/**
 * A preparação da marca antes do envio.
 *
 * O redimensionamento em si depende de `canvas`, que não existe em ambiente de
 * teste — o que se testa aqui é a decisão: o que entra, o que é recusado, e
 * com que mensagem. A recusa é a parte que a pessoa vê quando algo dá errado.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { prepareBrandImage } from "./brand-image";

function arquivo(tipo: string, nome = "marca.png"): File {
  return new File([new Uint8Array([1, 2, 3])], nome, { type: tipo });
}

describe("prepareBrandImage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("recusa formato que o documento não desenha", async () => {
    /* SVG carrega script e o gerador de PDF o recusa; parar aqui poupa a
       pessoa de descobrir isso depois do upload. */
    for (const tipo of ["image/svg+xml", "image/gif", "application/pdf"]) {
      const resultado = await prepareBrandImage(arquivo(tipo));
      expect(resultado.ok).toBe(false);
      if (!resultado.ok) {
        expect(resultado.error.kind).toBe("type");
        expect(resultado.error.message).toContain("PNG");
      }
    }
  });

  it("aceita os formatos que o navegador sabe redesenhar", async () => {
    /* Sem `createImageBitmap` o resultado é a falha de leitura, não a de
       formato: o que importa aqui é que o tipo passou pela triagem. */
    for (const tipo of ["image/png", "image/jpeg", "image/webp"]) {
      const resultado = await prepareBrandImage(arquivo(tipo));
      if (!resultado.ok) expect(resultado.error.kind).not.toBe("type");
    }
  });

  it("explica o que fazer quando a imagem não abre", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockRejectedValue(new Error("corrompida")),
    );

    const resultado = await prepareBrandImage(arquivo("image/png"));

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.error.kind).toBe("decode");
      /* Mensagem com saída: "não foi possível" sozinho deixa a pessoa parada. */
      expect(resultado.error.message).toContain("outro arquivo");
    }
  });
});

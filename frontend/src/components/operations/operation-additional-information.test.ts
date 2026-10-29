import { describe, expect, it } from "vitest";
import { operationAdditionalInformation } from "./operation-additional-information";
describe("informações adicionais do atendimento", () => {
  it("mostra dados úteis traduzidos e oculta referências internas, hashes e JSON", () => {
    const rows = operationAdditionalInformation(
      {
        street: "Rua das Flores",
        complement: "Bloco B",
        referencePoint: "Ao lado da praça",
      },
      {
        source: "MOBILE_WALK_IN",
        quoteId: "01900000-0000-7000-8000-000000000001",
        owner_id: "interno",
        token: "segredo",
        signatureHash: "hash",
        fieldExecution: { notes: "Duplicado em outro painel" },
        notes: "Chamar na portaria",
        contact: { name: "Maria", userId: "interno" },
        legacy: '{"id":"interno"}',
      },
    );
    expect(rows).toEqual(
      expect.arrayContaining([
        { label: "Ponto de referência", value: "Ao lado da praça" },
        {
          label: "Origem do atendimento",
          value: "Iniciado pelo técnico em campo",
        },
        { label: "Contato · Nome", value: "Maria" },
      ]),
    );
    expect(JSON.stringify(rows)).not.toMatch(
      /interno|segredo|Duplicado|quoteId|signatureHash/,
    );
  });
  it("não inventa conteúdo para dados vazios ou somente técnicos", () => {
    expect(
      operationAdditionalInformation(null, {
        quoteId: "01900000-0000-7000-8000-000000000001",
        metadata: { id: "x" },
      }),
    ).toEqual([]);
  });
});

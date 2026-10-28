import { describe, expect, it } from "vitest";
import {
  schedulingAddress,
  schedulingHistoryLabel,
  allocationStatusLabel,
} from "./event-presentation";

describe("apresentação do local do agendamento", () => {
  it("formata o endereço, complemento e referência sem serializar objetos", () => {
    expect(
      schedulingAddress({
        street: "Rua da Aurora",
        number: 100,
        complement: "Sala 2",
        district: "Boa Vista",
        city: "Recife",
        stateCode: "PE",
        postalCode: "50050000",
        notes: "Portaria azul",
      }),
    ).toEqual([
      "Rua da Aurora, 100",
      "Sala 2",
      "Boa Vista",
      "Recife / PE",
      "CEP 50050-000",
      "Referência: Portaria azul",
    ]);
  });
  it("aceita endereço legado como JSON em texto e endereço aninhado", () => {
    const address = {
      logradouro: "Rua A",
      numero: "20",
      localidade: "Paulista",
      uf: "PE",
    };
    expect(schedulingAddress(JSON.stringify(address))).toEqual([
      "Rua A, 20",
      "Paulista / PE",
    ]);
    expect(schedulingAddress({ address })).toEqual(schedulingAddress(address));
    expect(schedulingAddress({ address: JSON.stringify(address) })).toEqual(
      schedulingAddress(address),
    );
  });
  it("preserva localização em texto e não imprime estruturas desconhecidas", () => {
    expect(schedulingAddress("Recepção do prédio")).toEqual([
      "Recepção do prédio",
    ]);
    expect(
      schedulingAddress({
        internal: { id: "secret" },
        street: { invalid: true },
      }),
    ).toEqual([]);
    expect(schedulingAddress(null)).toEqual([]);
  });
  it("exibe coordenadas inclusive no equador", () => {
    expect(schedulingAddress({ lat: 0, lng: -34.9 })).toEqual([
      "Coordenadas: 0, -34.9",
    ]);
  });
  it("traduz informações de histórico e alocação", () => {
    expect(schedulingHistoryLabel("RESOURCE_ALLOCATED")).toBe(
      "Recurso adicionado à equipe",
    );
    expect(schedulingHistoryLabel("INTERNAL_UNKNOWN_EVENT")).toBe(
      "Agendamento atualizado",
    );
    expect(allocationStatusLabel("CONFIRMED")).toBe("Confirmado");
  });
});

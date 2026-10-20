import { describe, expect, it } from "vitest";

import {
  customerFormIssues,
  customerPayload,
  customerUpdatePayload,
  hasCustomerFormIssues,
  initialCustomerForm,
  type CustomerFormState,
} from "./customer-form";
import type { Customer } from "@/types/customers";

const form = (overrides: Partial<CustomerFormState> = {}): CustomerFormState => ({
  ...initialCustomerForm(null),
  legalName: "Clima Norte Refrigeração",
  ...overrides,
});

describe("initialCustomerForm", () => {
  it("abre vazio, como pessoa jurídica — o padrão da coluna no banco", () => {
    const state = initialCustomerForm(null);
    expect(state.type).toBe("COMPANY");
    expect(state.legalName).toBe("");
    expect(state.documentType).toBe("");
    expect(state.status).toBe("ACTIVE");
  });

  it("na edição parte do que o servidor publicou, endereço incluído", () => {
    const customer = {
      id: "c1",
      type: "INDIVIDUAL",
      legalName: "Ana Ribeiro",
      tradeName: null,
      documentType: "CPF",
      documentNumber: "39053344705",
      email: "ana@exemplo.com",
      phone: null,
      notes: null,
      status: "PROSPECT",
      address: { city: "Recife", stateCode: "PE", country: "" },
    } as unknown as Customer;

    const state = initialCustomerForm(customer);
    expect(state.legalName).toBe("Ana Ribeiro");
    expect(state.documentType).toBe("CPF");
    expect(state.status).toBe("PROSPECT");
    expect(state.address.city).toBe("Recife");
    /** Chave presente porém vazia continua vazia, não vira texto "null". */
    expect(state.address.country).toBe("");
  });
});

describe("customerPayload", () => {
  it("envia só o que foi preenchido", () => {
    expect(customerPayload(form())).toEqual({
      type: "COMPANY",
      legalName: "Clima Norte Refrigeração",
      tradeName: undefined,
      documentType: undefined,
      documentNumber: undefined,
      email: undefined,
      phone: undefined,
      notes: undefined,
      address: undefined,
    });
  });

  it("manda o documento em dígitos — a máscara é da tela", () => {
    const payload = customerPayload(
      form({ documentType: "CNPJ", documentNumber: "11.222.333/0001-81" }),
    );
    expect(payload.documentNumber).toBe("11222333000181");
  });

  it("não manda número sem tipo: o contrato exige os dois juntos", () => {
    const payload = customerPayload(form({ documentNumber: "39053344705" }));
    expect(payload.documentType).toBeUndefined();
    expect(payload.documentNumber).toBeUndefined();
  });

  it("omite o endereço quando nenhum campo tem conteúdo", () => {
    expect(customerPayload(form()).address).toBeUndefined();
  });

  it("envia apenas as chaves de endereço preenchidas", () => {
    const state = form();
    state.address.city = " Olinda ";
    state.address.stateCode = "PE";
    expect(customerPayload(state).address).toEqual({
      city: "Olinda",
      stateCode: "PE",
    });
  });

  it("não inclui status na criação — o contrato só o aceita na edição", () => {
    expect("status" in customerPayload(form())).toBe(false);
    expect(customerUpdatePayload(form({ status: "INACTIVE" })).status).toBe(
      "INACTIVE",
    );
  });
});

describe("customerFormIssues", () => {
  it("exige razão social com ao menos duas letras", () => {
    expect(customerFormIssues(form({ legalName: "A" })).legalName).toBeDefined();
    expect(customerFormIssues(form({ legalName: "  " })).legalName).toBeDefined();
    expect(customerFormIssues(form()).legalName).toBeUndefined();
  });

  it("cobra o tipo quando há número, e o número quando há tipo", () => {
    expect(
      customerFormIssues(form({ documentNumber: "39053344705" })).documentType,
    ).toBeDefined();
    expect(
      customerFormIssues(form({ documentType: "CPF" })).documentNumber,
    ).toBeDefined();
  });

  it("recusa dígito verificador que não confere", () => {
    expect(
      customerFormIssues(form({ documentType: "CPF", documentNumber: "111.111.111-11" }))
        .documentNumber,
    ).toBeDefined();
  });

  it("recusa documento do tamanho errado para o tipo escolhido", () => {
    /** CPF válido declarado como CNPJ: o servidor recusaria, e a tela também. */
    expect(
      customerFormIssues(
        form({ documentType: "CNPJ", documentNumber: "390.533.447-05" }),
      ).documentNumber,
    ).toBeDefined();
  });

  it("aceita CPF e CNPJ válidos", () => {
    expect(
      hasCustomerFormIssues(
        form({ documentType: "CPF", documentNumber: "390.533.447-05" }),
      ),
    ).toBe(false);
    expect(
      hasCustomerFormIssues(
        form({ documentType: "CNPJ", documentNumber: "11.222.333/0001-81" }),
      ),
    ).toBe(false);
  });

  it("valida o formato do e-mail, quando informado", () => {
    expect(customerFormIssues(form({ email: "sem-arroba" })).email).toBeDefined();
    expect(customerFormIssues(form({ email: "" })).email).toBeUndefined();
    expect(customerFormIssues(form({ email: "a@b.co" })).email).toBeUndefined();
  });

  it("não julga duplicidade: só o banco sabe", () => {
    const repeated = form({ documentType: "CPF", documentNumber: "390.533.447-05" });
    expect(hasCustomerFormIssues(repeated)).toBe(false);
  });
});

import { zodResolver } from "@hookform/resolvers/zod";
import { describe, expect, it } from "vitest";

import {
  signupSchema,
  TERMS_ACCEPTANCE_MESSAGE,
  type SignupFormValues,
} from "./signup-schema";

const valid: SignupFormValues = {
  firstName: "Marina",
  lastName: "Silva",
  email: "marina+orbit@example.test",
  password: "Orbit#Signup2026",
  confirmPassword: "Orbit#Signup2026",
  organizationName: "Empresa de teste",
  legalName: "Empresa de teste Ltda",
  documentNumber: "529.982.247-25",
  primarySegment: "Serviços",
  city: "Paulista",
  street: "Rua de teste, 100",
  stateCode: "PE",
  planKey: "PROFESSIONAL",
  billingInterval: "MONTHLY",
  terms: true,
};

describe("signup validation with Zod 4 and React Hook Form", () => {
  it.each(["529.982.247-25", "11.222.333/0001-81"])(
    "preserves valid CPF/CNPJ and all supported billing intervals: %s",
    (documentNumber) => {
      for (const billingInterval of [
        "MONTHLY",
        "SEMIANNUAL",
        "ANNUAL",
      ] as const) {
        const values = { ...valid, documentNumber, billingInterval };
        expect(signupSchema.parse(values)).toEqual(values);
      }
    },
  );

  it("resolves the actual form schema without changing successful values", async () => {
    const result = await zodResolver(signupSchema)(valid, undefined, {
      fields: {},
      shouldUseNativeValidation: false,
    });
    expect(result).toEqual({ errors: {}, values: valid });
  });

  it.each([false, undefined, "true"])(
    "rejects absent or non-boolean consent with the Portuguese message: %s",
    async (terms) => {
      const result = await zodResolver(signupSchema)(
        { ...valid, terms } as SignupFormValues,
        undefined,
        { fields: {}, shouldUseNativeValidation: false },
      );
      expect(result.values).toEqual({});
      expect(result.errors.terms?.message).toBe(TERMS_ACCEPTANCE_MESSAGE);
    },
  );

  it("keeps password mismatch attached to the confirmation field", async () => {
    const result = await zodResolver(signupSchema)(
      { ...valid, confirmPassword: "Orbit#Other2026" },
      undefined,
      { fields: {}, shouldUseNativeValidation: false },
    );
    expect(result.errors.confirmPassword?.message).toBe(
      "As senhas não coincidem",
    );
    expect(
      signupSchema.safeParse({
        ...valid,
        password: "weak",
        confirmPassword: "weak",
      }).success,
    ).toBe(false);
  });

  it.each([
    ["documentNumber", "11111111111", "Informe um CPF ou CNPJ válido"],
    ["documentNumber", "11222333000182", "Informe um CPF ou CNPJ válido"],
    ["email", "email inválido", "Informe um e-mail válido"],
    ["stateCode", "", "Use a sigla do estado"],
    ["billingInterval", "UNKNOWN", "Escolha a periodicidade da assinatura"],
  ])(
    "keeps validation errors usable in Portuguese: %s",
    (field, value, message) => {
      const result = signupSchema.safeParse({ ...valid, [field]: value });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toContainEqual(
          expect.objectContaining({ path: [field], message }),
        );
      }
    },
  );
});

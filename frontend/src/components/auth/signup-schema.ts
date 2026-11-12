import { z } from "zod";

import { isValidBrazilianDocument } from "@/lib/brazilian-document";
import { passwordPolicyIssues } from "@/lib/password-policy";
import { BILLING_INTERVALS } from "@/types/billing";

export const TERMS_ACCEPTANCE_MESSAGE =
  "Para continuar, aceite os Termos de Uso e confirme a leitura da Política de Privacidade.";

function requiredText(message: string, minimum = 2) {
  return z.string({ error: message }).min(minimum, message);
}

/** Shared with the form so the Zod/resolver migration exercises real validation. */
export const signupSchema = z
  .object({
    firstName: requiredText("Informe seu nome"),
    lastName: requiredText("Informe seu sobrenome"),
    email: z.email({ error: "Informe um e-mail válido" }),
    password: z
      .string({ error: "Informe uma senha" })
      .superRefine((password, context) => {
        for (const issue of passwordPolicyIssues(password)) {
          context.addIssue({ code: "custom", message: issue });
        }
      }),
    confirmPassword: z.string({ error: "Confirme sua senha" }),
    organizationName: requiredText("Informe o nome da organização"),
    legalName: requiredText("Informe a razão social"),
    documentNumber: z
      .string({ error: "Informe um CPF ou CNPJ válido" })
      .refine(isValidBrazilianDocument, "Informe um CPF ou CNPJ válido"),
    primarySegment: requiredText("Informe o segmento"),
    city: requiredText("Informe a cidade"),
    street: requiredText("Informe o endereço"),
    stateCode: z
      .string({ error: "Use a sigla do estado" })
      .length(2, "Use a sigla do estado"),
    planKey: requiredText("Escolha um plano para continuar", 1),
    billingInterval: z.enum(BILLING_INTERVALS, {
      error: "Escolha a periodicidade da assinatura",
    }),
    terms: z
      .boolean({ error: TERMS_ACCEPTANCE_MESSAGE })
      .refine(Boolean, TERMS_ACCEPTANCE_MESSAGE),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "As senhas não coincidem",
  });

export type SignupFormValues = z.infer<typeof signupSchema>;

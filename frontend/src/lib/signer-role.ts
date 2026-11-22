/**
 * O papel de quem assina, em palavras.
 *
 * Os modelos guardam o papel como código (`TECHNICAL_MANAGER`), e o mesmo mapa
 * vale no documento impresso (backend, `labels.ts`). Código desconhecido vira
 * "Assinante" — nunca sai cru na tela; texto livre ("Síndico") passa.
 */
const PAPEIS: Readonly<Record<string, string>> = {
  TECHNICAL_RESPONSIBLE: "Responsável técnico",
  TECHNICAL_MANAGER: "Responsável técnico",
  FIELD_TECHNICIAN: "Técnico em campo",
  ASSISTANT_TECHNICIAN: "Técnico auxiliar",
  TECHNICIAN: "Técnico responsável",
  OPERATOR: "Técnico",
  CUSTOMER: "Cliente",
  CUSTOMER_REPRESENTATIVE: "Representante do cliente",
  ISSUER: "Emitente",
  OWNER: "Responsável pela organização",
  MANAGER: "Gestor",
  WITNESS: "Testemunha",
};

export function signerRoleLabel(code: string | null | undefined): string {
  if (!code) return "Assinante";
  const known = PAPEIS[code.trim().toUpperCase()];
  if (known) return known;
  return /^[A-Z0-9]+(_[A-Z0-9]+)*$/.test(code) ? "Assinante" : code;
}

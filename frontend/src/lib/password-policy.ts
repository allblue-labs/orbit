export const PASSWORD_REQUIREMENTS = [
  {
    id: "length",
    label: "Pelo menos 12 caracteres",
    test: (password: string) => password.length >= 12,
  },
  {
    id: "lowercase",
    label: "Uma letra minúscula",
    test: (password: string) => /[a-z]/.test(password),
  },
  {
    id: "uppercase",
    label: "Uma letra maiúscula",
    test: (password: string) => /[A-Z]/.test(password),
  },
  {
    id: "number",
    label: "Um número",
    test: (password: string) => /\d/u.test(password),
  },
  {
    id: "special",
    label: "Um caractere especial (por exemplo: !, @, #)",
    test: (password: string) => /[^A-Za-z0-9\s]/.test(password),
  },
] as const;

export function passwordPolicyIssues(password: string): string[] {
  return PASSWORD_REQUIREMENTS.filter(
    (requirement) => !requirement.test(password),
  ).map((requirement) => requirement.label);
}

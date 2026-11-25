/**
 * O que o painel de acesso decide sem tela.
 *
 * O endereço final é do servidor — ele monta com o domínio da organização e
 * ignora qualquer outro. A prévia aqui usa a mesma limpeza do cadastro da
 * equipe para que o que o owner vê seja o que o servidor grava.
 */
import { localPartOf, sanitizeLocalPart } from "@/components/workforce/member-email";
import type {
  CustomerAccessCredentials,
  CustomerAccessIdentity,
} from "@/types/customer-portal-access";

/** O endereço que vai ser criado, ou `null` enquanto não há nome válido. */
export function accessEmailPreview(
  typed: string,
  domain: string | null,
): string | null {
  const nome = sanitizeLocalPart(localPartOf(typed));
  return nome && domain ? `${nome}@${domain}` : null;
}

/** A situação do acesso numa frase. */
export function accessStatusText(
  identity: CustomerAccessIdentity,
  formatDate: (iso: string) => string,
): string {
  if (identity.status === "disabled") return "Acesso desativado.";
  if (identity.mustChangePassword)
    return "Aguardando o primeiro acesso do cliente.";
  return identity.lastLoginAt
    ? `Último acesso em ${formatDate(identity.lastLoginAt)}.`
    : "Senha criada pelo cliente.";
}

/**
 * A mensagem que o owner manda ao cliente.
 *
 * Diz o que fazer, na ordem: baixar, escolher "Sou cliente", entrar, criar a
 * própria senha. Sem isso a pessoa recebe um e-mail e uma senha soltos.
 */
export function accessShareMessage(
  credentials: CustomerAccessCredentials,
  portalUrl?: string,
) {
  return [
    "Seu acesso ao portal do cliente Orbit:",
    `E-mail: ${credentials.identity.email}`,
    `Senha temporária: ${credentials.temporaryPassword}`,
    "",
    portalUrl
      ? `Entre pelo site ${portalUrl} ou pelo app Orbit (escolha "Sou cliente"). No primeiro acesso você cria a sua senha.`
      : 'Entre pelo app Orbit (escolha "Sou cliente") ou pelo portal do cliente no site. No primeiro acesso você cria a sua senha.',
  ].join("\n");
}

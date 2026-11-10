import { InfrastructureException } from '../../../exceptions';
import { IdentityTokenPurpose } from './identity.types';

/**
 * O endereço público que carrega um token de identidade.
 *
 * ## Por que é um lugar só
 *
 * O mesmo link precisa sair por dois caminhos: o e-mail que o Amazon SES
 * manda, e a cópia que o owner repassa por WhatsApp ou Telegram quando o
 * técnico não tem e-mail — que é a realidade de boa parte das equipes de campo.
 *
 * Se cada caminho montasse a própria URL, bastaria um renomear de rota no
 * frontend para que um dos dois passasse a entregar um link morto — e o que
 * quebraria seria justamente o caminho que ninguém testa até precisar.
 */
export function identityTokenLink(
  purpose: IdentityTokenPurpose,
  token: string,
): string {
  const base = process.env.IDENTITY_PUBLIC_WEB_URL?.trim();
  if (!base) {
    throw new InfrastructureException('IDENTITY_PUBLIC_WEB_URL is required');
  }
  const url = new URL(base);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' &&
      !(
        local &&
        process.env.NODE_ENV !== 'production' &&
        url.protocol === 'http:'
      )) ||
    url.username ||
    url.password
  ) {
    throw new InfrastructureException('IDENTITY_PUBLIC_WEB_URL must use HTTPS');
  }
  url.pathname =
    purpose === IdentityTokenPurpose.EMAIL_VERIFICATION
      ? '/confirmar-email'
      : purpose === IdentityTokenPurpose.INVITATION
        ? '/convite'
        : '/redefinir-senha';
  url.search = '';
  url.hash = '';
  // Verification tokens stay out of proxy/access logs and Referer headers.
  if (purpose === IdentityTokenPurpose.EMAIL_VERIFICATION)
    url.hash = `token=${encodeURIComponent(token)}`;
  else url.searchParams.set('token', token);
  return url.toString();
}

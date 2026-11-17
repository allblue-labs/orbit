import { actionEmail } from './email-template';
export const TRANSACTIONAL_TEMPLATES = [
  'WELCOME',
  'EMAIL_VERIFICATION',
  'PASSWORD_RESET',
  'PASSWORD_CHANGED',
  'PLAN_EXPIRED',
  'PLAN_LIMIT_REACHED',
] as const;
export type TransactionalTemplate = (typeof TRANSACTIONAL_TEMPLATES)[number];
/** Fixed editorial content; callers supply a trusted application URL, never HTML. */
export function transactionalEmail(
  template: TransactionalTemplate,
  input: {
    link: string;
    name?: string;
    organizationName?: string;
    resources?: readonly string[];
  },
) {
  const greeting = input.name ? `Olá, ${input.name.slice(0, 100)}. ` : '';
  const organization = input.organizationName
    ? ` da ${input.organizationName.slice(0, 160)}`
    : '';
  const copy = {
    WELCOME: {
      title: 'Bem-vindo ao Orbit! Confirme seu e-mail',
      introduction: `${greeting}Sua conta foi criada. Organize clientes, equipamentos e atendimentos em um só lugar. Confirme seu e-mail para proteger seu acesso e receber apenas comunicações importantes da sua conta.`,
      action: 'Confirmar meu e-mail',
      expiry:
        'O link é exclusivo, pode ser usado uma vez e expira em 24 horas. Se precisar de ajuda para começar, fale com contato@allblue-labs.com.',
    },
    EMAIL_VERIFICATION: {
      title: 'Confirme seu e-mail no Orbit',
      introduction: `${greeting}Você solicitou um novo link para confirmar o endereço da sua conta. Use o botão abaixo para concluir a confirmação.`,
      action: 'Confirmar meu e-mail',
      expiry:
        'Este link vale por 24 horas e substitui o anterior. Se você não solicitou o reenvio, ignore esta mensagem.',
    },
    PASSWORD_RESET: {
      title: 'Redefinição de senha do Orbit',
      introduction: `${greeting}Recebemos uma solicitação para redefinir sua senha. Use o botão para escolher uma nova senha com segurança.`,
      action: 'Redefinir minha senha',
      expiry:
        'O link pode ser usado uma vez e expira em 3 horas. Após salvar a nova senha, ele deixa de funcionar imediatamente. Se você não solicitou a alteração, sua senha permanece a mesma.',
    },
    PASSWORD_CHANGED: {
      title: 'Sua senha do Orbit foi alterada',
      introduction: `${greeting}A alteração da senha da sua conta foi concluída. As outras sessões foram encerradas conforme as regras de segurança do Orbit.`,
      action: 'Revisar a segurança da conta',
      expiry:
        'Se você não reconhece esta alteração, acesse o Orbit pelo endereço oficial, solicite a recuperação de senha e entre em contato com contato@allblue-labs.com. Nunca enviamos sua senha por e-mail.',
    },
    PLAN_EXPIRED: {
      title: 'Seu acesso ao Orbit precisa de atenção',
      introduction: `${greeting}O período de acesso${organization} terminou e ainda não identificamos uma reativação. Acesse Planos e assinatura para consultar as opções de continuidade.`,
      action: 'Consultar planos e assinatura',
      expiry:
        'Esta mensagem não confirma cobrança nem renovação automática. No cancelamento com retenção programada, os dados operacionais ficam disponíveis para retorno por até 30 dias após o vencimento; consulte o prazo exibido na sua conta.',
    },
    PLAN_LIMIT_REACHED: {
      title: 'Um limite do seu plano Orbit foi atingido',
      introduction: `${greeting}Identificamos limites atingidos ou ultrapassados${organization}. ${input.resources?.length ? `Confira: ${input.resources.slice(0, 12).join(', ')}. ` : ''}Consulte os detalhes e as opções de adequação na sua conta.`,
      action: 'Revisar os limites do plano',
      expiry:
        'Este aviso não altera o plano, não realiza cobranças e não exclui dados. Quando houver prazo de adequação, a data e os acessos afetados são mostrados no Orbit.',
    },
  }[template];
  return actionEmail({ ...copy, link: input.link });
}
/** Non-secret navigation only. Identity action links use identityTokenLink. */
export function accountEmailLink(security = false): string {
  const base = process.env.IDENTITY_PUBLIC_WEB_URL?.trim();
  if (!base) throw new Error('IDENTITY_PUBLIC_WEB_URL_REQUIRED');
  const url = new URL(base);
  if (
    url.username ||
    url.password ||
    (url.protocol !== 'https:' &&
      !(
        process.env.NODE_ENV !== 'production' &&
        url.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      ))
  )
    throw new Error('EMAIL_LINK_ORIGIN_INVALID');
  url.pathname = security ? '/perfil' : '/configuracoes';
  url.search = '';
  url.hash = '';
  return url.toString();
}

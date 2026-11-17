import { emailBrandImages } from './email-branding';
import type { EmailMessage } from './email.types';

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        char
      ]!,
  );

/** Self-contained transactional template; no trackers or third-party assets. */
export function actionEmail(input: {
  title: string;
  introduction: string;
  action: string;
  link: string;
  expiry: string;
}): Required<Pick<EmailMessage, 'subject' | 'text' | 'html' | 'inlineImages'>> {
  const { title, introduction, action, link, expiry } = input;
  const url = new URL(link);
  if (
    url.username ||
    url.password ||
    !['https:', 'http:'].includes(url.protocol)
  )
    throw new Error('EMAIL_ACTION_URL_INVALID');
  return {
    subject: title,
    inlineImages: emailBrandImages(),
    text: `${title}\n\n${introduction}\n\n${action}:\n${link}\n\n${expiry}\n\nSe você não esperava esta mensagem, pode ignorá-la. Sua senha nunca é enviada por e-mail.\n\nEquipe Orbit`,
    html: `<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;padding:32px 16px;background:#eef2f8;font-family:Arial,sans-serif;color:#172033"><table role="presentation" style="max-width:560px;width:100%;margin:auto;border:1px solid #dfe6f1;border-radius:20px;background:#fff;padding:32px"><tr><td><table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px"><tr><td style="padding-right:12px"><img src="cid:allblue-logo@orbit" alt="Símbolo da Allblue Labs" width="56" height="56" style="display:block;border:0"></td><td style="font-size:12px;letter-spacing:2px;font-weight:700;color:#40536d">ALLBLUE LABS</td></tr></table><img src="cid:orbit-logo@orbit" alt="Orbit" width="240" style="display:block;width:240px;max-width:100%;height:auto;border:0;margin:0 0 8px"><p style="font-size:14px;color:#687891;margin:0 0 28px">Sua operação conectada.</p><h1 style="font-size:24px;line-height:1.3">${escapeHtml(title)}</h1><p style="line-height:1.7">${escapeHtml(introduction)}</p><p style="margin:32px 0"><a href="${escapeHtml(link)}" style="display:inline-block;padding:14px 22px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:10px;font-weight:700">${escapeHtml(action)}</a></p><p style="line-height:1.6;color:#5b6475">${escapeHtml(expiry)}</p><p style="font-size:13px;line-height:1.6;color:#5b6475">Se você não esperava esta mensagem, pode ignorá-la. Sua senha nunca é enviada por e-mail.</p><hr style="border:0;border-top:1px solid #e5e7eb"><p style="font-size:12px;line-height:1.6;color:#5b6475">Se o botão não funcionar, copie este endereço para o navegador:</p><p style="font-size:12px;word-break:break-all"><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p></td></tr></table></body></html>`,
  };
}

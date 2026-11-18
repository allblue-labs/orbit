import { emailBrandImages } from './email-branding';
import type { EmailMessage } from './email.types';
export const escapeEmailHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        char
      ]!,
  );
/** HTML passed here is assembled only by server-side templates with escaped values. */
export function brandedEmail(
  title: string,
  text: string,
  bodyHtml: string,
): Required<Pick<EmailMessage, 'subject' | 'text' | 'html' | 'inlineImages'>> {
  return {
    subject: title,
    text,
    inlineImages: emailBrandImages(),
    html: `<!doctype html>
<html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:32px 16px;background:#eef2f8;font-family:Arial,sans-serif;color:#172033">
<table role="presentation" style="max-width:560px;width:100%;margin:auto;border:1px solid #dfe6f1;border-radius:20px;background:#fff;padding:32px"><tr><td>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px"><tr><td style="padding-right:8px"><img src="cid:allblue-logo@orbit" alt="Símbolo da Allblue Labs" width="32" height="32" style="display:block;width:32px;height:32px;border:0"></td><td style="font-size:12px;letter-spacing:2px;font-weight:700;color:#40536d">ALLBLUE LABS</td></tr></table>
<img src="cid:orbit-logo@orbit" alt="Orbit" width="144" height="46" style="display:block;width:144px;max-width:100%;height:auto;border:0;margin:0 0 8px">
<p style="font-size:14px;color:#687891;margin:0 0 28px">Sua operação conectada.</p>
<h1 style="font-size:24px;line-height:1.3">${escapeEmailHtml(title)}</h1>
${bodyHtml}
</td></tr></table></body></html>`,
  };
}

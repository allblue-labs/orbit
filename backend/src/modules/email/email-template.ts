import { brandedEmail, escapeEmailHtml as escapeHtml } from './email-layout';
/** Self-contained transactional template; no trackers or third-party assets. */
export function actionEmail(input: {
  title: string;
  introduction: string;
  action: string;
  link: string;
  expiry: string;
}) {
  const { title, introduction, action, link, expiry } = input;
  const url = new URL(link);
  if (
    url.username ||
    url.password ||
    !['https:', 'http:'].includes(url.protocol)
  )
    throw new Error('EMAIL_ACTION_URL_INVALID');
  return brandedEmail(
    title,
    `${title}\n\n${introduction}\n\n${action}:\n${link}\n\n${expiry}\n\nSe você não esperava esta mensagem, pode ignorá-la. Sua senha nunca é enviada por e-mail.\n\nEquipe Orbit · Allblue Labs`,
    `<p style="line-height:1.7">${escapeHtml(introduction)}</p>
<p style="margin:32px 0"><a href="${escapeHtml(link)}" style="display:inline-block;padding:14px 22px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:10px;font-weight:700">${escapeHtml(action)}</a></p>
<p style="line-height:1.6;color:#5b6475">${escapeHtml(expiry)}</p>
<p style="font-size:13px;line-height:1.6;color:#5b6475">Se você não esperava esta mensagem, pode ignorá-la. Sua senha nunca é enviada por e-mail.</p>
<hr style="border:0;border-top:1px solid #e5e7eb"><p style="font-size:12px;line-height:1.6;color:#5b6475">Se o botão não funcionar, copie este endereço para o navegador:</p>
<p style="font-size:12px;word-break:break-all"><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>`,
  );
}

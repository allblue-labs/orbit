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
}): { subject: string; text: string; html: string } {
  const { title, introduction, action, link, expiry } = input;
  return {
    subject: title,
    text: `${title}\n\n${introduction}\n\n${action}:\n${link}\n\n${expiry}\n\nSe você não esperava esta mensagem, pode ignorá-la. Sua senha nunca é enviada por e-mail.\n\nEquipe Orbit`,
    html: `<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;padding:32px 16px;background:#f4f6fa;font-family:Arial,sans-serif;color:#172033"><table role="presentation" style="max-width:560px;width:100%;margin:auto;border-radius:20px;background:#fff;padding:32px"><tr><td><p style="font-size:24px;font-weight:700;color:#4f46e5">Orbit</p><h1 style="font-size:24px;line-height:1.3">${escapeHtml(title)}</h1><p style="line-height:1.7">${escapeHtml(introduction)}</p><p style="margin:32px 0"><a href="${escapeHtml(link)}" style="display:inline-block;padding:14px 22px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:10px;font-weight:700">${escapeHtml(action)}</a></p><p style="line-height:1.6;color:#5b6475">${escapeHtml(expiry)}</p><p style="font-size:13px;line-height:1.6;color:#5b6475">Se você não esperava esta mensagem, pode ignorá-la. Sua senha nunca é enviada por e-mail.</p><hr style="border:0;border-top:1px solid #e5e7eb"><p style="font-size:12px;line-height:1.6;color:#5b6475">Se o botão não funcionar, copie este endereço para o navegador:</p><p style="font-size:12px;word-break:break-all"><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p></td></tr></table></body></html>`,
  };
}

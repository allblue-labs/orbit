import { brandedEmail, escapeEmailHtml as escape } from '../email/email-layout';
import type { PublicContactDto } from './public-contact.dto';
const TOPICS = {
  SUPPORT: 'Solicitação de suporte',
  FEEDBACK: 'Feedback e sugestões',
  QUESTION: 'Dúvida sobre o Orbit',
} as const;
export function supportContactEmail(input: PublicContactDto) {
  const topic = TOPICS[input.topic];
  return brandedEmail(
    `Orbit — ${topic}`,
    `${topic}\n\nNome: ${input.name}\nE-mail para resposta: ${input.email}\n\n${input.message}\n\nRecebido pelo formulário público do Orbit. Use Responder para falar com o remetente.`,
    `<p style="line-height:1.7"><strong>Nome:</strong> ${escape(input.name)}<br><strong>E-mail para resposta:</strong> ${escape(input.email)}<br><strong>Assunto:</strong> ${escape(topic)}</p>
<div style="line-height:1.7;padding:20px;background:#f4f6fb;border-radius:12px;overflow-wrap:anywhere">${escape(input.message).replace(/\r?\n/g, '<br>')}</div>
<p style="font-size:13px;line-height:1.6;color:#5b6475">Recebido pelo formulário público do Orbit. Use Responder para falar com o remetente.</p>`,
  );
}

/**
 * As frases e as datas das listas do Dashboard.
 *
 * "Atendimento concluído · Clínica Sol · por Marina · há 2 h" — o que
 * aconteceu, com quem e quando, em linguagem de operação. Puro, para teste.
 */
import type { DashboardFeedItem } from "@/types/dashboard";

export type FeedTone = "success" | "danger" | "info" | "warning" | "neutral";

const FRASES: Record<string, { text: string; tone: FeedTone }> = {
  "OPERATION:CREATED": { text: "Atendimento aberto", tone: "neutral" },
  "OPERATION:STARTED": { text: "Atendimento iniciado", tone: "info" },
  "OPERATION:COMPLETED": { text: "Atendimento concluído", tone: "success" },
  "OPERATION:SCHEDULED": { text: "Atendimento agendado", tone: "info" },
  "SERVICE_REQUEST:OPENED": { text: "Chamado aberto pelo cliente", tone: "warning" },
  "QUOTE:APPROVED": { text: "Orçamento aprovado", tone: "success" },
  "QUOTE:REJECTED": { text: "Orçamento recusado", tone: "danger" },
  "PMOC:COMPLETED": { text: "Manutenção de PMOC concluída", tone: "success" },
  "PMOC:DUE": { text: "Vencimento do PMOC", tone: "warning" },
  "RVT:COMPLETED": { text: "Visita de RVT concluída", tone: "success" },
  "RVT:SCHEDULED": { text: "Visita de RVT", tone: "info" },
};

export function feedSentence(item: DashboardFeedItem): { text: string; tone: FeedTone } {
  return FRASES[`${item.kind}:${item.event}`] ?? { text: item.title, tone: "neutral" };
}

const dayKey = (date: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
const hora = (date: Date, timeZone: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone, hour: "2-digit", minute: "2-digit" }).format(date);

/** Diferença em dias de calendário no fuso, de `a` para `b`. */
function diasEntre(a: Date, b: Date, timeZone: string): number {
  const [ya, ma, da] = dayKey(a, timeZone).split("-").map(Number);
  const [yb, mb, db] = dayKey(b, timeZone).split("-").map(Number);
  return Math.round((Date.UTC(yb!, mb! - 1, db!) - Date.UTC(ya!, ma! - 1, da!)) / 86_400_000);
}

/** Passado: "agora", "há 25 min", "há 3 h", "ontem 14:20", "12/11". */
export function sinceLabel(iso: string, now: Date, timeZone: string): string {
  const at = new Date(iso);
  const minutos = Math.round((now.getTime() - at.getTime()) / 60_000);
  if (minutos < 1) return "agora";
  if (minutos < 60) return `há ${minutos} min`;
  const dias = diasEntre(at, now, timeZone);
  if (dias === 0) return `há ${Math.round(minutos / 60)} h`;
  if (dias === 1) return `ontem ${hora(at, timeZone)}`;
  return new Intl.DateTimeFormat("pt-BR", { timeZone, day: "2-digit", month: "2-digit" }).format(at);
}

/** Futuro: "hoje 14:00", "amanhã 09:00", "qua 26/11 08:30"; dia inteiro sem hora. */
export function whenLabel(item: Pick<DashboardFeedItem, "at" | "allDay">, now: Date, timeZone: string): string {
  const at = new Date(item.at);
  /* Data sem hora vem como meia-noite UTC: lida em UTC, é o próprio dia. */
  const zona = item.allDay ? "UTC" : timeZone;
  const dias = diasEntre(item.allDay ? new Date(dayKey(now, timeZone) + "T12:00:00Z") : now, at, zona);
  const sufixo = item.allDay ? "" : ` ${hora(at, zona)}`;
  if (dias === 0) return `hoje${sufixo}`;
  if (dias === 1) return `amanhã${sufixo}`;
  const dia = new Intl.DateTimeFormat("pt-BR", { timeZone: zona, weekday: "short", day: "2-digit", month: "2-digit" })
    .format(at)
    .replace(".", "")
    .replace(",", "");
  return `${dia}${sufixo}`;
}

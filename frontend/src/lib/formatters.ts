/**
 * Formatação de apresentação compartilhada.
 *
 * Datas, horas e percentuais de confiança — usados por Dashboard, Operations
 * e módulos futuros. Formatação de **métricas** não mora aqui: é
 * responsabilidade do Metric Registry (`@/metrics`).
 */

import { DEFAULT_TIMEZONE } from "@/lib/env";

export type DateValue = string | Date | null | undefined;

function parse(timestamp: DateValue): Date | null {
  if (!timestamp) return null;
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date;
}

const cache = new Map<string, ReturnType<typeof buildDateFormatters>>();

function buildDateFormatters(timeZone: string) {
  const dateTime = new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const dateOnly = new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const shortDate = new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
  });
  const timeOnly = new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
  });
  const civilDate = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "UTC",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  return {
    formatDateTime(timestamp: DateValue): string {
      const date = parse(timestamp);
      return date ? dateTime.format(date) : "—";
    },
    formatDate(timestamp: DateValue): string {
      const date = parse(timestamp);
      // YYYY-MM-DD is a civil date (due date, coverage), never an instant.
      const formatter =
        typeof timestamp === "string" && /^\d{4}-\d{2}-\d{2}$/.test(timestamp)
          ? civilDate
          : dateOnly;
      return date ? formatter.format(date) : "—";
    },
    formatAxisDate(timestamp: string): string {
      const date = parse(timestamp);
      return date ? shortDate.format(date) : timestamp;
    },
    formatTime(timestamp: DateValue): string {
      const date = parse(timestamp);
      return date ? timeOnly.format(date) : "—";
    },
  };
}

/** Explicit, reusable formatters; safe for concurrent server requests. */
export function createDateFormatters(timeZone: string) {
  const cached = cache.get(timeZone);
  if (cached) return cached;
  const formatters = buildDateFormatters(timeZone);
  cache.set(timeZone, formatters);
  return formatters;
}

export function formatDateTime(
  timestamp: DateValue,
  timeZone = DEFAULT_TIMEZONE,
): string {
  return createDateFormatters(timeZone).formatDateTime(timestamp);
}

export function formatDate(
  timestamp: DateValue,
  timeZone = DEFAULT_TIMEZONE,
): string {
  return createDateFormatters(timeZone).formatDate(timestamp);
}

export function formatAxisDate(
  timestamp: string,
  timeZone = DEFAULT_TIMEZONE,
): string {
  return createDateFormatters(timeZone).formatAxisDate(timestamp);
}

export function formatTime(
  timestamp: DateValue,
  timeZone = DEFAULT_TIMEZONE,
): string {
  return createDateFormatters(timeZone).formatTime(timestamp);
}

/** Percentual de confiança já produzido pelo backend (0–1). */
export function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}% de confiança`;
}

/** Tamanho de arquivo em unidade legível. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const formatted = unit === 0 ? value : Math.round(value * 10) / 10;
  return `${formatted} ${units[unit]}`;
}

/**
 * As iniciais de um nome — o substituto da foto.
 *
 * Duas letras, sempre: uma só fica solitária num círculo, e três não cabem no
 * tamanho em que o avatar aparece nas listas. Nome vazio devolve vazio, e quem
 * chama decide o que colocar no lugar — inventar "?" aqui seria decidir a
 * apresentação de outra tela.
 */
export function initialsOf(name: string | null | undefined): string {
  return (name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

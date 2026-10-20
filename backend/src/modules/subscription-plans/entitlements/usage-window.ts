/**
 * A janela mensal de uso — sempre mensal, nunca do calendário.
 *
 * Cota é mensal qualquer que seja a periodicidade da cobrança: assinar por ano
 * não adianta doze meses de uso de uma vez, e nada sobra de um mês para o
 * outro. É a mesma aritmética ancorada da cobrança, com um mês de tamanho.
 */
import { anchoredPeriod, type AnchoredPeriod } from './anchored-period';

export type UsageWindow = AnchoredPeriod;

/** A janela mensal, ancorada, que contém `at`. */
export function monthlyWindow(anchor: Date, at: Date): UsageWindow {
  return anchoredPeriod(anchor, 1, at);
}

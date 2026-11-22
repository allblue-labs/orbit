/**
 * O segmento da organização em palavras.
 *
 * O cadastro guarda um código (`HVAC_R`); a tela mostra o ramo. Um segmento
 * que não está no mapa vira a forma legível do próprio código, sem `_`.
 */
const SEGMENTOS: Readonly<Record<string, string>> = {
  HVAC_R: "Refrigeração e climatização",
  HVACR: "Refrigeração e climatização",
  HVAC: "Climatização",
  REFRIGERATION: "Refrigeração",
  REFRIGERACAO: "Refrigeração",
  CLIMATIZACAO: "Climatização",
  GENERAL: "Geral",
  GLOBAL: "Geral",
};

export function segmentLabel(segment: string): string {
  const code = segment.trim().toUpperCase();
  const known = SEGMENTOS[code];
  if (known) return known;
  if (!/_/.test(segment) && segment !== code) return segment;
  const words = segment.replace(/_/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

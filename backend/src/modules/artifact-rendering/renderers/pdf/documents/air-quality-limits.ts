/**
 * Valores de referência da qualidade do ar interior.
 *
 * ## Por que o sistema passa a conhecê-los
 *
 * O template mede seis parâmetros e a própria descrição dele admite que "os
 * valores de referência dependem da norma aplicável". Na prática isso jogava a
 * consulta à norma para quem lê o relatório: uma folha com "820 UFC/m³" e nada
 * ao lado obriga o síndico a procurar a RE nº 9/2003 para saber se isso é bom
 * ou ruim. O número sozinho não informa.
 *
 * ## Comparar não é emitir parecer
 *
 * A distinção que sustenta este arquivo: dizer que 820 é maior que 750 é
 * **aritmética**; dizer que o ambiente está conforme é **juízo técnico**, e
 * pertence a quem assina o laudo. Por isso o resultado aqui se chama "acima do
 * VMR" e não "não conforme" — e por isso o parecer continua sendo o texto que
 * o responsável técnico escreveu, nunca uma conclusão que o gerador de PDF
 * tirou sozinho.
 *
 * ## Temperatura e umidade dependem da estação
 *
 * A norma dá faixas diferentes para verão e inverno. Codificar uma só daria
 * resultado errado em metade do ano, e o documento não sabe em que estação a
 * medição foi feita. A avaliação usa a **envoltória** das duas faixas: fora
 * dela está fora em qualquer estação, e isso é sempre verdade. Dentro dela
 * pode ainda estar fora da faixa da estação específica — por isso o documento
 * imprime a ressalva junto, em vez de deixar a leitura mais forte do que o
 * dado sustenta.
 */

export type LimitKind = 'MAX' | 'RANGE';

export interface AirQualityLimit {
  /** O `id` do campo no template oficial. */
  readonly field: string;
  readonly label: string;
  readonly unit: string;
  readonly kind: LimitKind;
  /** Valor máximo recomendável, para `MAX`. */
  readonly max?: number;
  /** Envoltória das faixas sazonais, para `RANGE`. */
  readonly min?: number;
  readonly rangeMax?: number;
  /** Como a referência é impressa na coluna do documento. */
  readonly reference: string;
  /** De onde o valor vem. Aparece no rodapé legal. */
  readonly source: string;
  /** Marcado quando a faixa muda com a estação. */
  readonly seasonal?: boolean;
}

export const RE9_SOURCE =
  'Resolução RE nº 9, de 16 de janeiro de 2003 (ANVISA) — Padrões ' +
  'Referenciais de Qualidade do Ar Interior em ambientes climatizados ' +
  'artificialmente de uso público e coletivo.';

export const AIR_QUALITY_LIMITS: readonly AirQualityLimit[] = [
  {
    field: 'fungos',
    label: 'Contagem de fungos',
    unit: 'UFC/m³',
    kind: 'MAX',
    max: 750,
    reference: 'até 750',
    source: 'RE 9/2003',
  },
  {
    field: 'particulas',
    label: 'Aerodispersóides totais',
    unit: 'µg/m³',
    kind: 'MAX',
    max: 80,
    reference: 'até 80',
    source: 'RE 9/2003',
  },
  {
    field: 'co2',
    label: 'Dióxido de carbono',
    unit: 'ppm',
    kind: 'MAX',
    max: 1000,
    reference: 'até 1.000',
    source: 'RE 9/2003',
  },
  {
    field: 'temperatura',
    label: 'Temperatura',
    unit: '°C',
    kind: 'RANGE',
    min: 20,
    rangeMax: 26,
    reference: '20 a 26',
    source: 'RE 9/2003 (envoltória sazonal)',
    seasonal: true,
  },
  {
    field: 'umidade',
    label: 'Umidade relativa',
    unit: '%',
    kind: 'RANGE',
    min: 35,
    rangeMax: 65,
    reference: '35 a 65',
    source: 'RE 9/2003 (envoltória sazonal)',
    seasonal: true,
  },
  {
    field: 'velocidade_ar',
    label: 'Velocidade do ar',
    unit: 'm/s',
    kind: 'MAX',
    max: 0.25,
    reference: 'até 0,25',
    source: 'RE 9/2003',
  },
];

export type LimitVerdict = 'WITHIN' | 'ABOVE' | 'BELOW' | 'UNKNOWN';

/**
 * O valor medido está dentro do referencial?
 *
 * `UNKNOWN` quando não há medição — e isso não é a mesma coisa que estar
 * dentro. Um parâmetro não medido impresso como "dentro do VMR" afirmaria uma
 * conformidade que ninguém verificou.
 */
export function evaluateLimit(
  limit: AirQualityLimit,
  value: number | undefined,
): LimitVerdict {
  if (value === undefined || !Number.isFinite(value)) return 'UNKNOWN';

  if (limit.kind === 'MAX') {
    if (limit.max === undefined) return 'UNKNOWN';
    return value > limit.max ? 'ABOVE' : 'WITHIN';
  }

  if (limit.min === undefined || limit.rangeMax === undefined) return 'UNKNOWN';
  if (value < limit.min) return 'BELOW';
  if (value > limit.rangeMax) return 'ABOVE';
  return 'WITHIN';
}

export function limitFor(field: string): AirQualityLimit | undefined {
  return AIR_QUALITY_LIMITS.find((limit) => limit.field === field);
}

/** Como a situação sai impressa. Nunca "conforme": isso é de quem assina. */
export function verdictLabel(verdict: LimitVerdict): string {
  const rotulos: Readonly<Record<LimitVerdict, string>> = {
    WITHIN: 'Dentro do VMR',
    ABOVE: 'Acima do VMR',
    BELOW: 'Abaixo da faixa',
    UNKNOWN: 'Não medido',
  };
  return rotulos[verdict];
}

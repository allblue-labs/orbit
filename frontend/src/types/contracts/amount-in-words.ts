/**
 * ARQUIVO GERADO — NÃO EDITE MANUALMENTE.
 * Fonte: backend/src
 * Regenerar: npm run contracts:sync
 */

/**
 * Valor por extenso, em português do Brasil.
 *
 * ## Por que um recibo precisa disto
 *
 * O extenso não é enfeite: é a defesa contra adulteração. Um "1" vira "7" com
 * um traço de caneta, e "R$ 120,00" vira "R$ 7.120,00" com espaço sobrando à
 * esquerda. "cento e vinte reais" não se altera sem que se veja. É por isso
 * que cheque, recibo e contrato repetem o número em palavras, e é por isso que
 * um recibo sem extenso vale menos como prova.
 *
 * ## Por que mora nos contratos
 *
 * O documento imprime o extenso e a tela o mostra na revisão, antes de emitir.
 * Duas implementações escreveriam o mesmo número de formas diferentes na
 * primeira vez que alguém corrigisse uma só — e a divergência apareceria como
 * "a tela diz uma coisa e o PDF diz outra" sobre dinheiro. Aqui é código puro,
 * sem import nenhum, sincronizado para o cliente como qualquer contrato.
 *
 * ## Por que escrito aqui e não com biblioteca
 *
 * As regras do "e" em português não são as do inglês, e é justamente nelas que
 * as bibliotecas genéricas erram: `mil e duzentos` mas `mil duzentos e trinta`,
 * `cem` mas `cento e um`, `mil e dois` mas `mil cento e um`. Uma dependência
 * que acerte 95% dos casos produz recibos errados nos 5% — e quem confere é o
 * cliente, depois de emitido.
 */
const UNIDADES = [
  'zero',
  'um',
  'dois',
  'três',
  'quatro',
  'cinco',
  'seis',
  'sete',
  'oito',
  'nove',
  'dez',
  'onze',
  'doze',
  'treze',
  'quatorze',
  'quinze',
  'dezesseis',
  'dezessete',
  'dezoito',
  'dezenove',
];

const DEZENAS = [
  '',
  '',
  'vinte',
  'trinta',
  'quarenta',
  'cinquenta',
  'sessenta',
  'setenta',
  'oitenta',
  'noventa',
];

const CENTENAS = [
  '',
  'cento',
  'duzentos',
  'trezentos',
  'quatrocentos',
  'quinhentos',
  'seiscentos',
  'setecentos',
  'oitocentos',
  'novecentos',
];

/** Singular e plural de cada classe, do menos significativo ao mais. */
const CLASSES: readonly [string, string][] = [
  ['', ''],
  ['mil', 'mil'],
  ['milhão', 'milhões'],
  ['bilhão', 'bilhões'],
  ['trilhão', 'trilhões'],
];

/** Até 999, sem classe. */
function grupoPorExtenso(numero: number): string {
  if (numero === 100) return 'cem';

  const centena = Math.floor(numero / 100);
  const resto = numero % 100;
  const partes: string[] = [];

  if (centena > 0) partes.push(CENTENAS[centena]!);

  if (resto > 0) {
    if (resto < 20) {
      partes.push(UNIDADES[resto]!);
    } else {
      const dezena = Math.floor(resto / 10);
      const unidade = resto % 10;
      partes.push(
        unidade === 0
          ? DEZENAS[dezena]!
          : `${DEZENAS[dezena]!} e ${UNIDADES[unidade]!}`,
      );
    }
  }

  return partes.join(' e ');
}

/**
 * O inteiro por extenso, com as regras de ligação entre classes.
 *
 * O "e" antes da última classe entra quando ela vale menos de cem **ou** é
 * centena redonda: "mil e dois", "mil e duzentos", mas "mil duzentos e trinta".
 * Fora disso as classes se separam por espaço, e por vírgula quando há três ou
 * mais — que é como se escreve um valor longo sem ficar ilegível.
 */
export function inteiroPorExtenso(valor: number): string {
  if (!Number.isFinite(valor) || valor < 0) return '';
  const inteiro = Math.floor(valor);
  if (inteiro === 0) return 'zero';

  const grupos: number[] = [];
  let restante = inteiro;
  while (restante > 0) {
    grupos.push(restante % 1000);
    restante = Math.floor(restante / 1000);
  }
  if (grupos.length > CLASSES.length) return '';

  const escritos: string[] = [];
  for (let indice = grupos.length - 1; indice >= 0; indice -= 1) {
    const grupo = grupos[indice]!;
    if (grupo === 0) continue;

    const [singular, plural] = CLASSES[indice]!;
    /* "mil" não leva "um" na frente: é "mil", nunca "um mil". */
    const corpo = indice === 1 && grupo === 1 ? 'mil' : grupoPorExtenso(grupo);
    const classe = indice === 0 ? '' : grupo === 1 ? singular : plural;

    escritos.push(
      indice === 1 && grupo === 1
        ? corpo
        : [corpo, classe].filter(Boolean).join(' '),
    );
  }

  if (escritos.length === 1) return escritos[0]!;

  const ultimo = escritos[escritos.length - 1]!;
  const anteriores = escritos.slice(0, -1);
  const ultimoGrupo = grupos[0]!;
  const ligaComE =
    ultimoGrupo > 0 && (ultimoGrupo < 100 || ultimoGrupo % 100 === 0);

  const inicio = anteriores.join(escritos.length > 2 ? ', ' : ' ');
  return ligaComE ? `${inicio} e ${ultimo}` : `${inicio} ${ultimo}`;
}

/**
 * O valor monetário por extenso: reais e centavos.
 *
 * Os centavos vêm do arredondamento para duas casas, e não do truncamento:
 * `0.1 + 0.2` em ponto flutuante é `0.30000000000000004`, e truncar produziria
 * "vinte e nove centavos" num recibo de trinta.
 */
export function valorPorExtenso(valor: number): string {
  if (!Number.isFinite(valor) || valor < 0) return '';

  const centavosTotais = Math.round(valor * 100);
  const reais = Math.floor(centavosTotais / 100);
  const centavos = centavosTotais % 100;

  const partes: string[] = [];
  if (reais > 0) {
    partes.push(
      `${inteiroPorExtenso(reais)} ${reais === 1 ? 'real' : 'reais'}`,
    );
  }
  if (centavos > 0) {
    partes.push(
      `${inteiroPorExtenso(centavos)} ${centavos === 1 ? 'centavo' : 'centavos'}`,
    );
  }

  /* Zero é valor válido num recibo de cortesia, e "zero reais" é o que se
     escreve — omitir deixaria o campo vazio, que é pior. */
  if (partes.length === 0) return 'zero reais';
  return partes.join(' e ');
}

/** `R$ 1.234,56`. */
export function moeda(valor: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(valor);
}

/**
 * O texto que um PDF realmente imprime.
 *
 * ## Por que não basta ler os bytes
 *
 * Duas camadas separam a palavra do arquivo. Os streams de conteúdo são
 * comprimidos, e dentro deles o texto é gravado em hexadecimal — mas os
 * códigos **não são** os caracteres: com fonte embutida, o pdfkit gera um
 * subconjunto da fonte e numera os glifos na ordem em que aparecem. O byte
 * `0x24` pode ser um "A" num documento e um "ç" no seguinte.
 *
 * O que traduz de volta é o `/ToUnicode`, um CMap que o próprio pdfkit embute
 * para que buscar e copiar texto funcione em qualquer leitor.
 *
 * ## E cada fonte tem a sua numeração
 *
 * O documento usa Inter em dois pesos, e **cada peso é uma fonte com sua
 * própria tabela**: o código 5 é uma letra no Medium e outra no Semibold.
 * Juntar os dois mapas num dicionário só faz um sobrescrever o outro — o
 * texto sai legível onde a fonte vencedora foi usada e embaralhado no resto,
 * que é pior que sair todo errado, porque parece funcionar.
 *
 * Por isso este módulo segue o operador `Tf`, que é como o PDF diz "daqui em
 * diante, esta fonte", e decodifica cada trecho com a tabela certa.
 *
 * ## Por que mora em `test/`
 *
 * É ferramenta de teste e só. Em `src/` iria para o bundle de produção, já que
 * o build só exclui `*.spec.ts` — e um extrator de PDF que ninguém chama em
 * produção é peso morto que alguém um dia tenta usar.
 */
import { inflateSync } from 'node:zlib';

interface Objeto {
  readonly corpo: string;
  readonly stream?: string;
}

/** Os objetos indiretos do arquivo, por número. */
function lerObjetos(pdf: Buffer): Map<number, Objeto> {
  const bruto = pdf.toString('latin1');
  const objetos = new Map<number, Objeto>();

  for (const encontrado of bruto.matchAll(/(\d+) 0 obj\b/g)) {
    const numero = Number(encontrado[1]);
    const inicio = encontrado.index + encontrado[0].length;
    const fim = bruto.indexOf('endobj', inicio);
    if (fim < 0) continue;

    const bloco = bruto.slice(inicio, fim);
    const marcador = /stream\r?\n/.exec(bloco);
    if (!marcador) {
      objetos.set(numero, { corpo: bloco });
      continue;
    }

    const corpo = bloco.slice(0, marcador.index);
    const dados = bloco.slice(
      marcador.index + marcador[0].length,
      bloco.indexOf('endstream'),
    );
    let conteudo: string;
    try {
      conteudo = inflateSync(Buffer.from(dados, 'latin1')).toString('latin1');
    } catch {
      conteudo = dados;
    }
    objetos.set(numero, { corpo, stream: conteudo });
  }

  return objetos;
}

/** `00E7` → "ç"; pares de 4 dígitos viram vários caracteres. */
function decodificar(hex: string): string {
  let texto = '';
  for (let i = 0; i + 3 < hex.length; i += 4) {
    texto += String.fromCodePoint(Number.parseInt(hex.slice(i, i + 4), 16));
  }
  return texto;
}

/** Código do glifo → caractere, de um único CMap. */
function lerCMap(cmap: string): Map<number, string> {
  const mapa = new Map<number, string>();

  for (const bloco of cmap.match(/beginbfchar([\s\S]*?)endbfchar/g) ?? []) {
    for (const [, codigo, destino] of bloco.matchAll(
      /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g,
    )) {
      mapa.set(Number.parseInt(codigo!, 16), decodificar(destino!));
    }
  }

  for (const bloco of cmap.match(/beginbfrange([\s\S]*?)endbfrange/g) ?? []) {
    /**
     * `bfrange` tem duas formas, e o pdfkit usa a de array:
     *
     * ```
     * <0020> <0025> <0041>                    incremental
     * <0000> <003b> [<0049> <0064> <0065> …]  array, um destino por código
     * ```
     */
    for (const [, de, , lista] of bloco.matchAll(
      /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*\[([\s\S]*?)\]/g,
    )) {
      const inicio = Number.parseInt(de!, 16);
      [...lista!.matchAll(/<([0-9a-fA-F]*)>/g)].forEach(([, hex], indice) => {
        mapa.set(inicio + indice, decodificar(hex ?? ''));
      });
    }

    /* Os arrays saem antes: o padrão incremental casaria trios de códigos
       dentro deles e sobrescreveria as entradas certas com lixo. */
    const semArrays = bloco.replace(
      /<[0-9a-fA-F]+>\s*<[0-9a-fA-F]+>\s*\[[\s\S]*?\]/g,
      '',
    );
    for (const [, de, ate, destino] of semArrays.matchAll(
      /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g,
    )) {
      const inicio = Number.parseInt(de!, 16);
      const fim = Number.parseInt(ate!, 16);
      const base = Number.parseInt(destino!, 16);
      for (let i = 0; inicio + i <= fim; i += 1) {
        mapa.set(inicio + i, String.fromCodePoint(base + i));
      }
    }
  }

  return mapa;
}

/** Nome do recurso (`/F1`) → tabela de unicode daquela fonte. */
function tabelasPorFonte(
  objetos: Map<number, Objeto>,
): Map<string, Map<number, string>> {
  const porFonte = new Map<string, Map<number, string>>();

  for (const objeto of objetos.values()) {
    for (const [, dicionario] of objeto.corpo.matchAll(
      /\/Font\s*<<([\s\S]*?)>>/g,
    )) {
      for (const [, nome, referencia] of (dicionario ?? '').matchAll(
        /\/(\w+)\s+(\d+) 0 R/g,
      )) {
        const fonte = objetos.get(Number(referencia));
        const unicode = /\/ToUnicode\s+(\d+) 0 R/.exec(fonte?.corpo ?? '');
        if (!unicode) continue;
        const cmap = objetos.get(Number(unicode[1]))?.stream;
        if (cmap) porFonte.set(nome!, lerCMap(cmap));
      }
    }
  }

  return porFonte;
}

/**
 * O texto do documento, na ordem em que foi escrito.
 *
 * Sem espaço entre as chamadas de escrita: cada `text()` vira uma sequência, e
 * inserir separador inventaria espaços que o documento não tem. As asserções
 * procuram trechos contíguos.
 */
export function pdfText(pdf: Buffer): string {
  const objetos = lerObjetos(pdf);
  const porFonte = tabelasPorFonte(objetos);

  const pedacos: string[] = [];
  for (const objeto of objetos.values()) {
    const conteudo = objeto.stream;
    if (!conteudo || conteudo.includes('begincmap')) continue;

    let ativa: Map<number, string> | undefined;
    /* `Tf` troca a fonte; `<…>` e `(…)` escrevem. Uma varredura só, na ordem
       do stream, é o que mantém cada trecho com a tabela que valia nele. */
    for (const passo of conteudo.matchAll(
      /\/(\w+)\s+[\d.]+\s+Tf|<([0-9a-fA-F]*)>|\(((?:\\.|[^)\\])*)\)/g,
    )) {
      const [, fonte, hex, literal] = passo;

      if (fonte !== undefined) {
        ativa = porFonte.get(fonte);
        continue;
      }

      if (hex !== undefined) {
        if (!ativa) {
          pedacos.push(Buffer.from(hex, 'hex').toString('latin1'));
          continue;
        }
        for (let i = 0; i + 3 < hex.length; i += 4) {
          const codigo = Number.parseInt(hex.slice(i, i + 4), 16);
          pedacos.push(ativa.get(codigo) ?? '');
        }
        continue;
      }

      if (literal !== undefined) pedacos.push(literal);
    }
  }

  /* `Intl` separa número e unidade com espaço inquebrável: certo para
     impressão, ruim para comparar em teste. */
  return pedacos.join('').replace(/\u{00a0}/gu, ' ');
}

/** Quantas páginas o documento tem. */
export function pdfPageCount(pdf: Buffer): number {
  return (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
}

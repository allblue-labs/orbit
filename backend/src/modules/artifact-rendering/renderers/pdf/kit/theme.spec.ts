/**
 * O tema, e a distinção entre "sem cor" e "cor escolhida".
 *
 * Este teste nasce de um defeito real: `safeColor` devolve o próprio fallback
 * quando não recebe cor válida, e o fallback dele é quase preto. Todo
 * documento que não passava `primaryColor` saía monocromático **achando que
 * tinha cor** — era o caso do plano de PMOC e do orçamento.
 */
import PDFDocument from 'pdfkit';

import { buildTheme, FONT_FILES, FONTS, registerFonts } from './theme';

/** Razão de contraste da WCAG 2.1 entre duas cores hexadecimais. */
function contraste(a: string, b: string): number {
  const luminancia = (hex: string): number => {
    const canais = [1, 3, 5]
      .map(
        (posicao) => Number.parseInt(hex.slice(posicao, posicao + 2), 16) / 255,
      )
      .map((canal) =>
        canal <= 0.04045 ? canal / 12.92 : ((canal + 0.055) / 1.055) ** 2.4,
      );
    return 0.2126 * canais[0]! + 0.7152 * canais[1]! + 0.0722 * canais[2]!;
  };
  const [claro, escuro] = [luminancia(a), luminancia(b)].sort(
    (esquerda, direita) => direita - esquerda,
  );
  return (claro! + 0.05) / (escuro! + 0.05);
}

describe('buildTheme', () => {
  it('usa o degradê do Orbit quando a organização não escolheu cor', () => {
    const tema = buildTheme();

    /* Os dois pontos de `--gradient-orbit`, convertidos de OKLCH. */
    expect(tema.accent).toBe('#156CDD');
    expect(tema.accentEnd).toBe('#8250DA');
  });

  it('não confunde ausência de cor com cor quase preta', () => {
    const tema = buildTheme();

    /* O fallback de `safeColor`. Se ele voltar a vazar para cá, o documento
       inteiro perde a cor sem que nada acuse. */
    expect(tema.accent).not.toBe('#17213a');
  });

  it('respeita a cor da organização e deriva o fim do degradê dela', () => {
    const tema = buildTheme('#1B4DB1');

    expect(tema.accent).toBe('#1B4DB1');
    /* O fim é a própria cor girada no matiz: o documento ganha profundidade
       sem exibir a marca do Orbit sobre o timbre de outra empresa. */
    expect(tema.accentEnd).not.toBe('#8250DA');
    expect(tema.accentEnd).not.toBe(tema.accent);
  });

  it('cai no Orbit quando a cor é inválida', () => {
    for (const invalida of ['', 'azul', 'rgb(1,2,3)', '#12345']) {
      expect(buildTheme(invalida).accent).toBe('#156CDD');
    }
  });

  it('mantém os rótulos acima do mínimo de contraste da WCAG', () => {
    const tema = buildTheme();

    /* `inkFaint` carrega os rótulos dos cartões, em corpo 7. Abaixo de 4,5
       sobre o branco eles somem na folha impressa — foi o que aconteceu com
       `#7F8696`, que dava 3,65. */
    expect(contraste(tema.inkFaint, '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
    expect(contraste(tema.ink, '#FFFFFF')).toBeGreaterThanOrEqual(7);
    /* Texto branco sobre a faixa do cabeçalho. */
    expect(contraste(tema.onShell, tema.shellStart)).toBeGreaterThanOrEqual(7);
    expect(
      contraste(tema.onShellMuted, tema.shellStart),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it('não deixa o fim da faixa mais claro que o início', () => {
    const tema = buildTheme();

    /* O roxo ocupa a metade direita da faixa, onde fica o timbre. Mais claro
       que o azul, é ele que define a leitura de "claro" e a faixa parece
       lavada mesmo com o início escuro. */
    expect(contraste(tema.shellEnd, '#FFFFFF')).toBeGreaterThanOrEqual(
      contraste(tema.shellStart, '#FFFFFF'),
    );
  });

  it('dá amplitude à faixa em vez de duas pontas na mesma casa', () => {
    const tema = buildTheme();

    /* Um degradê entre dois tons igualmente escuros lê como mancha chapada.
       O azul da ponta esquerda precisa ser visivelmente mais claro que o roxo
       do fim para a faixa ter definição. */
    const claroDoInicio = contraste(tema.shellStart, '#FFFFFF');
    const claroDoFim = contraste(tema.shellEnd, '#FFFFFF');
    expect(claroDoFim - claroDoInicio).toBeGreaterThan(1.5);
  });

  it('mantém os neutros fora da marca', () => {
    const orbit = buildTheme();
    const cliente = buildTheme('#B11B4D');

    /* Só o destaque acompanha a organização; contraste é responsabilidade
       nossa em qualquer cor escolhida. */
    for (const token of ['ink', 'inkMuted', 'border', 'surface'] as const) {
      expect(cliente[token]).toBe(orbit[token]);
    }
  });
});

describe('registerFonts', () => {
  /**
   * O documento tem de sair mesmo sem os arquivos de fonte.
   *
   * Isto nasce de um defeito real, e o pior tipo: o `catch` vazio do registro
   * dava a impressão de tolerar a ausência. Não tolerava — sem registro, o nome
   * lógico não existe e `document.font('Inter-Semibold')` é tratado como caminho
   * de arquivo, estourando `ENOENT` na primeira linha de texto. Na imagem de
   * produção, onde `assets/` não era copiada, **toda** emissão premium falhava
   * com 500, e nenhum teste via: no host o arquivo está lá.
   */
  it('usa fonte padrão do PDF quando o arquivo não existe', () => {
    const document = new PDFDocument({ bufferPages: true });
    /* Registro anotado em lista própria: `mock.calls` chega como `any`, e ler
       argumento por índice num teste sobre fonte é tão frágil quanto o defeito
       que ele cerca. */
    const registrados: { nome: string; origem: string }[] = [];

    jest.spyOn(document, 'registerFont').mockImplementation(function (
      this: PDFKit.PDFDocument,
      nome,
      origem,
    ) {
      /* `registerFont` também aceita buffer; aqui só chega string, e o que o
         teste examina é o caminho ou o apelido. */
      const caminho = typeof origem === 'string' ? origem : '';
      registrados.push({ nome, origem: caminho });
      /* Só o caminho de arquivo falha; o apelido para fonte padrão passa. */
      if (caminho.endsWith('.ttf')) {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      }
      return this;
    });

    registerFonts(document);

    for (const nome of Object.keys(FONT_FILES)) {
      const apelido = registrados.find(
        (registro) =>
          registro.nome === nome && !registro.origem.endsWith('.ttf'),
      );
      expect(apelido?.origem).toMatch(/^Helvetica/);
    }
  });

  it('escreve texto em todos os pesos depois de registrar, sem estourar', () => {
    /* O teste que faltava: registrar e **usar**. A falha só aparecia no primeiro
       `document.font(...)`, e não no registro. */
    const document = new PDFDocument({ bufferPages: true });
    registerFonts(document);

    for (const peso of [FONTS.regular, FONTS.bold, FONTS.strong, FONTS.mono]) {
      expect(() =>
        document.font(peso).text('Documento de teste'),
      ).not.toThrow();
    }
  });
});

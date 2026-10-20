/**
 * Gera as amostras de `amostras-pdf/`.
 *
 * ## Por que isto existe
 *
 * As amostras são a única forma de conferir o desenho — teste de unidade lê
 * texto, não vê layout. Enquanto cada ajuste era acompanhado de um script
 * descartável, cada script gerava um subconjunto diferente e sobrescrevia o
 * anterior: as oito amostras nunca estavam todas na mesma versão do kit, e uma
 * delas chegou a ficar sem o logo que a mudança tinha acabado de adicionar.
 *
 * Um gerador só, versionado, com os mesmos dados de exemplo para todos os
 * documentos. Rodar depois de mexer no kit:
 *
 * ```
 * npx ts-node --compiler-options '{"module":"commonjs"}' scripts/gerar-amostras.ts
 * ```
 *
 * Os dados são fictícios de propósito, inclusive o logo — que é desenhado aqui
 * mesmo, e não lido de um arquivo do projeto. Usar a marca do Orbit numa
 * amostra sugere que o documento carimba a nossa marca, quando o que ele
 * imprime é a do inquilino.
 *
 * ## Os dados vêm de `sample-document.factory`
 *
 * Eles moravam aqui. Desde que a tela de Modelos passou a mostrar a amostra ao
 * usuário, o mesmo conteúdo serve para conferir o desenho e para demonstrar o
 * modelo — e dois conjuntos separados fariam o segundo nunca ser revisado com o
 * mesmo cuidado. O que continua sendo deste script é o **emitente**: aqui ele é
 * inventado, com logo desenhado, porque não há inquilino nenhum na linha de
 * comando.
 */
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { ArtifactPremiumPdfRenderer } from '../src/modules/artifact-rendering/renderers/pdf/artifact-premium-pdf.renderer';
import { PmocPlanDocumentService } from '../src/modules/artifact-rendering/pmoc-plan-document.service';
import { QuoteDocumentService } from '../src/modules/artifact-rendering/quote-document.service';
import {
  SAMPLE_ARTIFACT_TYPES,
  samplePmocPlan,
  sampleQuote,
  sampleRenderInput,
} from '../src/modules/artifact-rendering/sample-document.factory';

/* ------------------------------------------------------------------ */
/* Logo de exemplo                                                     */
/* ------------------------------------------------------------------ */

/** Um PNG desenhado na hora: marca fictícia de um cliente fictício. */
function logoDeExemplo(): Buffer {
  const largura = 360;
  const altura = 96;
  const pixels: number[][] = Array.from({ length: altura }, () =>
    new Array<number>(largura * 4).fill(0),
  );

  const pintar = (x: number, y: number, cor: [number, number, number]) => {
    if (x < 0 || x >= largura || y < 0 || y >= altura) return;
    const base = x * 4;
    pixels[y]![base] = cor[0];
    pixels[y]![base + 1] = cor[1];
    pixels[y]![base + 2] = cor[2];
    pixels[y]![base + 3] = 255;
  };

  /* Disco com o degradê da marca do cliente. */
  const cx = 44;
  const cy = 48;
  const raio = 34;
  for (let y = 0; y < altura; y += 1) {
    for (let x = 0; x < largura; x += 1) {
      const distancia = Math.hypot(x - cx, y - cy);
      if (distancia > raio) continue;
      const t = (x - (cx - raio)) / (2 * raio);
      pintar(x, y, [
        Math.round(14 + (168 - 14) * t),
        Math.round(116 + (72 - 116) * t),
        Math.round(196 + (188 - 196) * t),
      ]);
    }
  }

  /* Letras "CN" em blocos, e a razão social abaixo. */
  const tinta: [number, number, number] = [18, 28, 54];
  const bloco = (x0: number, y0: number, w: number, h: number) => {
    for (let y = y0; y < y0 + h; y += 1) {
      for (let x = x0; x < x0 + w; x += 1) pintar(x, y, tinta);
    }
  };
  let x = 100;
  for (const w of [30, 10, 26, 10, 34, 10, 28, 10, 32]) {
    bloco(x, 30, w, 14);
    x += w + 6;
  }
  for (let i = 0; i < 3; i += 1) {
    bloco(100, 56 + i * 9, 150 - i * 30, 4);
  }

  const bruto: number[] = [];
  for (let y = 0; y < altura; y += 1) {
    bruto.push(0, ...pixels[y]!);
  }

  const crcTabela = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buffer: Buffer): number => {
    let c = 0xffffffff;
    for (const byte of buffer) c = crcTabela[(c ^ byte) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const pedaco = (tipo: string, dados: Buffer): Buffer => {
    const corpo = Buffer.concat([Buffer.from(tipo, 'latin1'), dados]);
    const tamanho = Buffer.alloc(4);
    tamanho.writeUInt32BE(dados.length);
    const verificacao = Buffer.alloc(4);
    verificacao.writeUInt32BE(crc(corpo));
    return Buffer.concat([tamanho, corpo, verificacao]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0);
  ihdr.writeUInt32BE(altura, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pedaco('IHDR', ihdr),
    pedaco('IDAT', deflateSync(Buffer.from(bruto))),
    pedaco('IEND', Buffer.alloc(0)),
  ]);
}

const LOGO = logoDeExemplo();

const emitter = {
  logo: LOGO,
  logoMimeType: 'image/png',
  tradeName: 'Clima Norte',
  legalName: 'Clima Norte Serviços de Refrigeração Ltda',
  document: 'CNPJ 11.222.333/0001-81',
  address: 'Rua Girassol, 742 — Pinheiros',
  cityState: 'São Paulo/SP',
  phone: '+55 11 4002-8922',
  email: 'contato@climanorte.com.br',
};

/** O arquivo de cada tipo, com os nomes que `amostras-pdf/` já usava. */
const ARQUIVOS: Readonly<Record<string, string>> = {
  ORDEM_SERVICO: 'OS-premium.pdf',
  RELATORIO_VISITA: 'RVT-premium.pdf',
  RECIBO: 'RECIBO-premium.pdf',
  RELATORIO_TECNICO: 'LAUDO-TECNICO-premium.pdf',
  QUALIDADE_AR: 'QUALIDADE-AR-premium.pdf',
  PMOC: 'PMOC-execucao.pdf',
  ORCAMENTO: 'ORCAMENTO-premium.pdf',
};

/** Data fixa: duas execuções do gerador têm de produzir os mesmos bytes. */
const GERADO_EM = new Date('2026-09-25T18:00:00.000Z');

async function main(): Promise<void> {
  const renderer = new ArtifactPremiumPdfRenderer();
  const destino = '../amostras-pdf';
  const escrever = (nome: string, bytes: Buffer) => {
    writeFileSync(`${destino}/${nome}`, bytes);
    console.log(`  ${nome.padEnd(30)} ${bytes.length} bytes`);
  };

  console.log('gerando amostras com logo de cliente:');

  for (const tipo of SAMPLE_ARTIFACT_TYPES) {
    if (tipo === 'ORCAMENTO') continue;
    const saida = await renderer.render(
      sampleRenderInput(tipo, { emitter, generatedAt: GERADO_EM }),
    );
    escrever(ARQUIVOS[tipo]!, saida.bytes);
  }

  escrever(
    'PMOC-plano.pdf',
    await new PmocPlanDocumentService().render({
      emitter,
      generatedAt: GERADO_EM,
      plan: samplePmocPlan(),
    }),
  );

  escrever(
    ARQUIVOS.ORCAMENTO!,
    await new QuoteDocumentService().render({
      emitter,
      generatedAt: GERADO_EM,
      quote: sampleQuote(),
    }),
  );
}

void main();

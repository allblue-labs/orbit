#!/usr/bin/env node
/**
 * Guard de linguagem de produto.
 *
 * A interface do Orbit fala com quem opera uma empresa de refrigeração, não com
 * quem mantém o código. Este script procura vocabulário de implementação
 * **no texto que a pessoa lê** — e só nele.
 *
 * O recorte importa: `sourceId` como nome de variável é código correto;
 * `sourceId` dentro de uma frase na tela é vazamento. Por isso o script
 * remove comentários, isola literais de string e texto JSX, e descarta o que
 * é claramente código (caminhos de import, classes utilitárias, identificadores
 * soltos). Um regex ingênuo sobre o arquivo inteiro acusaria centenas de falsos
 * positivos e seria desligado na primeira semana.
 *
 *   node scripts/check-product-language.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOTS = ["app", "src"];
/**
 * `src/server/bff` é encanamento de transporte: suas mensagens são de
 * diagnóstico para quem mantém o proxy, nunca renderizadas.
 */
const SKIP_DIRS = new Set(["node_modules", ".next", "__snapshots__", "bff"]);

/**
 * Termos de implementação que não pertencem à interface.
 *
 * A lista nasceu da auditoria da PR-FE-H01, não de suposição: cada entrada
 * apareceu em texto real exibido ao usuário.
 */
const FORBIDDEN = [
  { term: "backend", pattern: /\bback[- ]?end\b/i },
  { term: "servidor", pattern: /\bservidor(es)?\b/i },
  { term: "Read Model", pattern: /\bread\s*models?\b/i },
  { term: "endpoint", pattern: /\bendpoints?\b/i },
  { term: "state machine", pattern: /\bstate\s*machine\b/i },
  { term: "allowedActions", pattern: /\ballowedActions\b/ },
  { term: "blockedReason", pattern: /\bblockedReasons?\b/ },
  { term: "sourceType/sourceId", pattern: /\bsource(Type|Id)\b/ },
  { term: "snapshot", pattern: /\bsnapshots?\b/i },
  { term: "hash", pattern: /\bhash(es)?\b/i },
  { term: "payload", pattern: /\bpayloads?\b/i },
  { term: "DTO", pattern: /\bDTOs?\b/ },
  { term: "renderização", pattern: /\brenderiza(ção|r|ndo|dor)\b/i },
  { term: "fila de jobs", pattern: /\b(fila de jobs|job queue|worker)\b/i },
  { term: "idempotência", pattern: /\bidempot\w*/i },
  { term: "status HTTP", pattern: /\bHTTP\s*\d{3}\b|\bdevolve\s+\d{3}\b|→\s*\d{3}\b/ },
  { term: "Read Model / projeção", pattern: /\bprojeç(ão|ões)\s+de\s+leitura\b/i },
  { term: "manifest", pattern: /\bmanifests?\b/i },
  { term: "tenant", pattern: /\btenants?\b/i },
  { term: "nome de tipo do código", pattern: /\b(Artifact|Pmoc|Rvt|Mobile|Field)[A-Z]\w*(ReadModel|Execution|Dto|Entity|Signature|Repository)\b/ },
  { term: "variável de ambiente", pattern: /\b[A-Z][A-Z0-9]{3,}(_[A-Z0-9]+)+\b(?!\s*[·—])/ },
  { term: "rota de API", pattern: /(^|\s)\/(api|analytics|operations|customers|financial|ai-executions|artifact)[\w/-]*/ },
];

/** Remove comentários preservando strings. */
function stripComments(src) {
  let out = "";
  for (let i = 0; i < src.length; ) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      out += c;
      i += 1;
      while (i < src.length) {
        if (src[i] === "\\") {
          out += src.slice(i, i + 2);
          i += 2;
          continue;
        }
        out += src[i];
        if (src[i] === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (src.startsWith("//", i)) {
      const end = src.indexOf("\n", i);
      i = end < 0 ? src.length : end;
      continue;
    }
    if (src.startsWith("/*", i)) {
      const end = src.indexOf("*/", i);
      i = end < 0 ? src.length : end + 2;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

const STRING = /"([^"\\\n]{2,400})"|'([^'\\\n]{2,400})'|`([^`\\]{2,400})`/gs;
const JSX_TEXT = />\s*([^<>{}\n][^<>{}]{1,300}?)\s*</gs;
/**
 * Texto que começa depois de uma interpolação real.
 *
 * `{data.currency}. Totais calculados pelo servidor.` é frase visível, e o
 * padrão acima não a alcança porque ela não começa em `>`.
 */
const JSX_AFTER_EXPR = /\}\s*([^<>{}\n][^<>{}]{1,300}?)\s*</gs;

/** Fragmentos que são código, não frase. */
function looksLikeCode(text) {
  if (!/\s/.test(text) && /^[\w@./\-:]+$/.test(text)) return true;
  if (/^(https?:\/\/|\.\.?\/|@\/)/.test(text)) return true;
  if (/[{}();=>]{2,}|\breturn\b|\bconst\b|\bexport\b|\bimport\b|=>|\?\?|\btypeof\b/.test(text)) {
    return true;
  }
  // Assinaturas TypeScript capturadas por engano: `(id: string): Promise`.
  if (/\b(Promise|Readonly|Record|Partial|Awaited|ReturnType)\b/.test(text)) return true;
  // Fragmentos de ternário JSX: `) : algo.error ? (`.
  if (/^\)\s*:|\?\s*\($|^\(\s*$/.test(text.trim())) return true;
  if (/\breadonly\b|\bnull \| undefined\b|\[\]\s*\|/.test(text)) return true;
  /**
   * `(id: string, input: Update…)` é assinatura; "definido: logotipo, cores"
   * é prosa. A diferença confiável é o acento: assinatura TypeScript não tem
   * nenhum, e frase em português quase sempre tem. Sem esta condição o gate
   * ficava cego para qualquer frase com dois-pontos seguidos de lista — foi
   * assim que três vazamentos passaram.
   */
  if (!/[À-úçÇ]/.test(text) && /\w+\s*:\s*[A-Za-z<]\w*\s*[,)]/.test(text)) {
    return true;
  }
  const utility =
    /(^|\s)(flex|grid|px-|py-|pt-|pb-|pl-|pr-|mt-|mb-|ml-|mr-|text-|bg-|border|rounded|gap-|w-|h-|min-|max-|space-|items-|justify-|hover:|focus:|sm:|md:|lg:|xl:)/;
  if (utility.test(text) && !/[À-úçÇ]/.test(text)) return true;
  return false;
}

/**
 * Remove interpolações.
 *
 * `${ARTIFACT_LIMITS.maxSections}` é código; o que a pessoa lê é o **valor**.
 * Sem esta limpeza o guard acusaria todo identificador em maiúsculas dentro de
 * um template literal — o tipo de falso positivo que faz um gate ser desligado.
 */
function stripInterpolations(text) {
  return text.replace(/\$\{[^}]*\}/g, "…");
}

/** Frase de verdade: tem palavras, e não é fragmento de expressão. */
function isProse(text) {
  return text.trim().split(/\s+/).length >= 3 && /[a-zà-ú]{3}/i.test(text);
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      yield* walk(full);
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    if (/\.(test|spec)\.tsx?$/.test(entry)) continue;
    yield full;
  }
}

/**
 * Texto técnico mantido de propósito, com o motivo.
 *
 * Nem toda ocorrência é vazamento: há mensagens que existem **para quem mantém
 * o sistema** e nunca chegam a uma tela de produto. Ficam aqui, nomeadas, em
 * vez de sumirem numa exceção genérica — o gate precisa ser auditável.
 */
const ALLOWED = [
  {
    file: "src/lib/env.ts",
    reason:
      "Erro de programação: dispara quando o cliente do navegador é usado no " +
      "servidor. Nunca chega ao usuário — quebra o build ou o log do dev.",
  },
  {
    file: "src/components/panels/panel-error-boundary.tsx",
    reason:
      "Mensagem de console em desenvolvimento, para localizar o painel que " +
      "quebrou. O que o usuário vê é o estado de erro do painel.",
  },
];

const findings = [];
for (const root of ROOTS) {
  for (const file of walk(root)) {
    /**
     * Interpolações de espaçamento somem antes da extração.
     *
     * O JSX quebra uma frase em pedaços com `{" "}` para caber na linha. Sem
     * juntá-los, o guard lê "conta é do servidor, não do navegador —, o" como
     * três fragmentos e nenhum deles é frase — foi assim que seis vazamentos
     * atravessaram o gate.
     */
    const source = stripComments(readFileSync(file, "utf8")).replace(
      /\{\s*["'`]\s*["'`]\s*\}/g,
      " ",
    );
    const lineOf = (index) => source.slice(0, index).split("\n").length;

    const texts = [];
    for (const match of source.matchAll(STRING)) {
      const value = (match[1] ?? match[2] ?? match[3] ?? "").trim();
      if (value) texts.push([value, match.index]);
    }
    for (const match of source.matchAll(JSX_TEXT)) {
      const value = match[1].trim();
      if (value) texts.push([value, match.index]);
    }
    for (const match of source.matchAll(JSX_AFTER_EXPR)) {
      const value = match[1].trim();
      if (value) texts.push([value, match.index]);
    }

    for (const [raw, index] of texts) {
      const text = stripInterpolations(raw);
      if (looksLikeCode(text) || !isProse(text)) continue;
      const allowance = ALLOWED.find((entry) =>
        relative(process.cwd(), file).startsWith(entry.file),
      );
      if (allowance) continue;

      for (const { term, pattern } of FORBIDDEN) {
        if (pattern.test(text)) {
          findings.push({
            file: relative(process.cwd(), file),
            line: lineOf(index),
            term,
            text: text.replace(/\s+/g, " ").slice(0, 120),
          });
        }
      }
    }
  }
}

if (findings.length === 0) {
  console.log("Linguagem de produto: nenhum termo de implementação na interface.");
  process.exit(0);
}

console.error(`Linguagem de produto: ${findings.length} ocorrência(s).\n`);
for (const f of findings) {
  console.error(`  ${f.file}:${f.line}  [${f.term}]`);
  console.error(`    ${f.text}`);
}
console.error(
  "\nA interface descreve o que aconteceu e o que fazer, não como o sistema" +
    "\nfoi implementado. Consulte docs/product-language.md.",
);
process.exit(1);

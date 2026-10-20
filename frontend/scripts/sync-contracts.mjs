#!/usr/bin/env node
/**
 * Copia os contratos do backend (NestJS) para o frontend.
 *
 * O backend é a única fonte de verdade dos contratos da API. Dois conjuntos
 * são sincronizados:
 *
 * 1. `backend/src/contracts` — tipos e literais base da plataforma.
 * 2. Read Models de módulos (dashboards, analytics, scheduling) — tipos puros
 *    que descrevem exatamente o que cada endpoint devolve.
 *
 * Ambos contêm apenas TypeScript puro, sem dependências de runtime. Os Read
 * Models são copiados preservando `modules/<módulo>/` para que os imports
 * relativos entre eles continuem válidos.
 *
 * Não usamos import direto (`../backend/src/...`) porque o build de produção
 * do frontend roda em um contexto Docker isolado (`./frontend`), onde o
 * diretório do backend não existe.
 *
 * Uso: npm run contracts:sync
 */
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(here, "..");
const backendSrc = resolve(frontendRoot, "..", "backend", "src");
const source = resolve(backendSrc, "contracts");
const target = resolve(frontendRoot, "src", "types", "contracts");

/**
 * Read Models expostos pela API e consumidos pelo frontend.
 * Caminhos relativos a `backend/src`.
 */
execFileSync("npm", ["run", "contracts:guard"], {
  cwd: resolve(frontendRoot, "..", "backend"),
  stdio: "inherit",
});
const manifest = JSON.parse(
  await readFile(
    resolve(frontendRoot, "..", "backend", "contracts-sync.manifest.json"),
    "utf8",
  ),
);
const READ_MODELS = manifest.readModels;

const BANNER = `/**
 * ARQUIVO GERADO — NÃO EDITE MANUALMENTE.
 * Fonte: backend/src
 * Regenerar: npm run contracts:sync
 */
`;

if (!existsSync(source)) {
  console.error(`[contracts] diretório de origem não encontrado: ${source}`);
  process.exit(1);
}

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
/*
 * Os testes ficam no backend, que é onde o código nasce.
 *
 * Copiá-los produzia um `*.spec.ts` no frontend que o vitest **não** executa —
 * ele só casa `*.test.ts`. Um arquivo de teste que nunca roda é pior que nenhum:
 * parece cobertura e não é.
 */
await cp(source, target, {
  recursive: true,
  filter: (path) => !path.endsWith(".spec.ts"),
});

for (const readModel of READ_MODELS) {
  const from = resolve(backendSrc, readModel);
  if (!existsSync(from)) {
    console.error(`[contracts] Read Model não encontrado: ${from}`);
    process.exit(1);
  }
  const to = join(target, readModel);
  await mkdir(dirname(to), { recursive: true });
  await cp(from, to);
  const content = await readFile(to, "utf8");
  await writeFile(
    to,
    content.replaceAll("from '../../contracts'", "from '../..'"),
    "utf8",
  );
}

/** @param {string} directory */
async function stampBanner(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await stampBanner(path);
      continue;
    }
    if (!entry.name.endsWith(".ts")) {
      await rm(path);
      continue;
    }
    const content = await readFile(path, "utf8");
    await writeFile(path, `${BANNER}\n${content}`, "utf8");
    console.log(`[contracts] ${relative(frontendRoot, path)}`);
  }
}

await stampBanner(target);
console.log("[contracts] sincronização concluída.");

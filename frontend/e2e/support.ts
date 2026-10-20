/**
 * Instrumentação compartilhada do smoke de navegador.
 *
 * O que cada teste ganha de graça: um coletor de console e de falha de rede
 * que transforma ruído silencioso em asserção. Um `console.error` do React —
 * hydration, `key` faltando, input que troca de controlado para não
 * controlado — passa despercebido em navegação manual e reprova aqui.
 */
import { expect, type ConsoleMessage, type Page, type Request } from "@playwright/test";

export const OWNER = {
  email: process.env.ORBIT_OWNER_EMAIL ?? "owner@orbit.local",
  password: process.env.ORBIT_OWNER_PASSWORD ?? "OrbitOwner@2026",
};

/**
 * Ruído que não é da aplicação.
 *
 * O Next injeta avisos de desenvolvimento e o Chromium reclama de recursos
 * externos que o ambiente local não serve. Filtrar isso mantém o gate afiado:
 * qualquer outra mensagem de erro reprova.
 */
const IGNORED = [
  /Download the React DevTools/i,
  /favicon\.ico/i,
  /net::ERR_INTERNET_DISCONNECTED/i,
];

export interface Recorder {
  readonly consoleErrors: string[];
  readonly pageErrors: string[];
  readonly failedRequests: string[];
  /** Mensagens que a React só emite como aviso, mas que são defeito. */
  readonly reactWarnings: string[];
}

const REACT_DEFECTS =
  /(hydrat|did not match|Each child in a list should have a unique "key"|changing an? (un)?controlled input|Cannot update a component|validateDOMNesting|in a <[a-z]+> which is|Warning: Failed prop type)/i;

export function record(page: Page): Recorder {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  const reactWarnings: string[] = [];

  const relevant = (text: string) => !IGNORED.some((pattern) => pattern.test(text));

  page.on("console", (message: ConsoleMessage) => {
    const text = message.text();
    if (!relevant(text)) return;
    if (message.type() === "error") consoleErrors.push(text);
    if (REACT_DEFECTS.test(text)) reactWarnings.push(text);
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request: Request) => {
    const failure = request.failure()?.errorText ?? "";
    /** Cancelamento é comportamento esperado — o app aborta o que ficou velho. */
    if (failure.includes("ERR_ABORTED") || failure.includes("net::ERR_ABORTED")) return;
    if (!relevant(request.url())) return;
    failedRequests.push(`${request.method()} ${request.url()} — ${failure}`);
  });

  return { consoleErrors, pageErrors, failedRequests, reactWarnings };
}

/** O gate: nada de erro de runtime na jornada. */
export function assertClean(recorder: Recorder, where: string): void {
  expect(recorder.pageErrors, `exceções não tratadas em ${where}`).toEqual([]);
  expect(recorder.consoleErrors, `console.error em ${where}`).toEqual([]);
  expect(recorder.reactWarnings, `avisos de React em ${where}`).toEqual([]);
  expect(recorder.failedRequests, `requisições falhas em ${where}`).toEqual([]);
}

/** Sessão real: BFF, cookies HttpOnly, backend sob papel restrito. */
export async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel(/e-?mail/i).fill(OWNER.email);
  await page.getByLabel(/senha/i).first().fill(OWNER.password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL(/\/(dashboard|)$/, { timeout: 30_000 });
}

/** A página parou de buscar? Evita asserção sobre esqueleto. */
export async function settled(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle").catch(() => undefined);
}

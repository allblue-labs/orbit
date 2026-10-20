/**
 * Testes de unidade do frontend.
 *
 * ## Escopo deliberadamente estreito
 *
 * Só lógica pura: autoridade de ações, formatação, apresentação de erro. Nada
 * de DOM, nada de snapshot. A regra de negócio é do backend e já é testada lá
 * — reproduzi-la aqui criaria uma segunda verdade que envelhece na primeira
 * mudança do servidor, que é exatamente o que esta PR combate.
 *
 * O que vale testar no navegador é o que o navegador decide: como uma lista de
 * ações publicada pelo servidor vira menu, como um erro vira frase.
 */
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});

// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import noConcurrentTransactionQueries from './eslint-rules/no-concurrent-transaction-queries.mjs';

export default tseslint.config(
  {
    /** `dist/**` é saída de build: lintá-la esgota a memória e não diz nada. */
    ignores: [
      'eslint.config.mjs',
      'eslint-rules/**',
      'src/generated/**',
      'dist/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    plugins: {
      orbit: { rules: { 'no-concurrent-transaction-queries': noConcurrentTransactionQueries } },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      /**
       * Consulta concorrente sobre o mesmo cliente transacional.
       *
       * A causa raiz da PR-26.6.1. Ver
       * `eslint-rules/no-concurrent-transaction-queries.mjs` e
       * `docs/transaction-concurrency.md`.
       */
      'orbit/no-concurrent-transaction-queries': 'error',
    },
  },
  {
    files: ['scripts/nexus-contract*.cjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { parserOptions: { projectService: false } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
);

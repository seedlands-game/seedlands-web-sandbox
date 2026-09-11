import js from '@eslint/js';
import globals from 'globals';
import svelte from 'eslint-plugin-svelte';
import tseslint from 'typescript-eslint';
import { createSeedlandsPlugin } from './index.mjs';

/** Create the repository flat config without reading the root eslint.config.mjs. */
export function createSeedlandsConfig(workspaceRoot) {
  const seedlands = createSeedlandsPlugin(workspaceRoot);
  const packageBoundary = {
    plugins: { seedlands },
    rules: { 'seedlands/package-boundary': 'error' },
  };
  const productPlatformBoundary = {
    plugins: { seedlands },
    rules: { 'seedlands/node-platform-boundary': 'error' },
  };

  return tseslint.config(
    {
      ignores: [
        'coverage/**',
        '**/dist/**',
        'apps/web/public/packs/**',
        'harness/results/**',
        'midscene_run/**',
        'node_modules/**',
        'playwright-report/**',
        'test-results/**',
        'wasm/**/_build/**',
      ],
    },
    {
      files: ['**/*.{js,mjs,cjs,ts,mts,cts,svelte}'],
      linterOptions: { noInlineConfig: true },
      rules: { 'max-lines': ['error', { max: 500, skipBlankLines: true, skipComments: true }] },
    },
    {
      files: ['**/*.{js,mjs,cjs}'],
      extends: [js.configs.recommended],
      languageOptions: { globals: globals.node },
    },
    {
      files: ['**/*.{ts,mts,cts}'],
      extends: [js.configs.recommended, ...tseslint.configs.recommended],
      languageOptions: { globals: { ...globals.browser, ...globals.node, ...globals.worker } },
      rules: {
        '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      },
    },
    ...svelte.configs['flat/recommended'],
    {
      files: ['**/*.svelte'],
      languageOptions: { parserOptions: { parser: tseslint.parser } },
    },
    {
      files: ['apps/web/src/app/**/*.ts'],
      ignores: ['apps/web/src/app/ui/mount-ui.ts'],
      plugins: { seedlands },
      rules: { 'seedlands/ui-presentation-boundary': 'error', 'seedlands/authority-worker-owner': 'error' },
    },
    {
      files: ['apps/web/src/app/*.{ts,svelte}'],
      ignores: ['apps/web/src/app/player-view-offsets.ts'],
      plugins: { seedlands },
      rules: { 'seedlands/app-top-level-owner': 'error' },
    },
    {
      files: ['apps/web/src/client/*.ts'],
      ignores: ['apps/web/src/client/performance-telemetry.ts'],
      plugins: { seedlands },
      rules: { 'seedlands/client-top-level-owner': 'error' },
    },
    {
      files: ['apps/web/src/client/**/*.ts'],
      plugins: { seedlands },
      rules: { 'seedlands/authority-worker-owner': 'error', 'seedlands/client-no-app-import': 'error' },
    },
    {
      files: ['packages/kernel/src/**/*.ts'],
      plugins: { seedlands },
      rules: { 'seedlands/core-compute-purity': 'error' },
    },
    {
      files: ['packages/stdlib/src/world/**/*.ts'],
      plugins: { seedlands },
      rules: { 'seedlands/world-purity': 'error' },
    },
    {
      files: ['packages/stdlib/src/physics/**/*.ts', 'packages/stdlib/src/runtime/**/*.ts'],
      plugins: { seedlands },
      rules: { 'seedlands/pure-runtime': 'error' },
    },
    {
      files: ['apps/web/src/compute/**/*.ts', 'packages/stdlib/src/compute/**/*.ts'],
      plugins: { seedlands },
      rules: { 'seedlands/compute-purity': 'error' },
    },
    {
      files: ['packages/stdlib/src/server/**/*.ts'],
      plugins: { seedlands },
      languageOptions: { globals: globals.node },
      rules: { 'seedlands/server-purity': 'error' },
    },
    {
      files: ['playbooks/*/src/**/*.ts'],
      plugins: { seedlands },
      rules: { 'seedlands/pack-api-boundary': 'error' },
    },
    {
      files: ['apps/*/src/**/*.{ts,svelte}', 'packages/*/src/**/*.{ts,mts,cts}', 'playbooks/*/src/**/*.ts'],
      ...packageBoundary,
    },
    {
      files: [
        'apps/*/src/**/*.{ts,svelte}',
        'packages/cognition-protocol/src/**/*.{ts,mts,cts}',
        'packages/kernel/src/**/*.{ts,mts,cts}',
        'packages/stdlib/src/**/*.{ts,mts,cts}',
        'playbooks/*/src/**/*.ts',
      ],
      ...productPlatformBoundary,
    },
  );
}

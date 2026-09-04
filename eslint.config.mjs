import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const worldForbiddenImports = (source) =>
  source === 'playcanvas' || source.includes('/server/') || source.includes('/client/');
const serverForbiddenImports = (source) => source === 'playcanvas' || source.includes('/client/');
const forbiddenRuntimeGlobals = new Set([
  'window',
  'document',
  'requestAnimationFrame',
  'self',
  'postMessage',
  'Worker',
]);

const purityRule = (forbiddenImport) => ({
  meta: {
    type: 'problem',
    schema: [],
    messages: { forbidden: '此目录只能包含纯逻辑，禁止依赖 {{dependency}}。' },
  },
  create(context) {
    const reportImport = (node) => {
      const source = typeof node.source?.value === 'string' ? node.source.value : null;
      if (source && forbiddenImport(source))
        context.report({ node, messageId: 'forbidden', data: { dependency: source } });
    };
    return {
      ImportDeclaration: reportImport,
      ImportExpression: reportImport,
      CallExpression(node) {
        if (node.callee.type !== 'Identifier' || node.callee.name !== 'require') return;
        const [argument] = node.arguments;
        if (argument?.type === 'Literal' && typeof argument.value === 'string' && forbiddenImport(argument.value))
          context.report({ node, messageId: 'forbidden', data: { dependency: argument.value } });
      },
      Identifier(node) {
        if (!forbiddenRuntimeGlobals.has(node.name)) return;
        if (node.parent.type === 'Property' && node.parent.key === node && !node.parent.computed) return;
        if (node.parent.type === 'MemberExpression' && node.parent.property === node && !node.parent.computed) return;
        context.report({ node, messageId: 'forbidden', data: { dependency: node.name } });
      },
    };
  },
});

const seedlands = {
  rules: {
    'world-purity': purityRule(worldForbiddenImports),
    'server-purity': purityRule(serverForbiddenImports),
  },
};

export default tseslint.config(
  {
    ignores: [
      'coverage/**',
      'dist/**',
      'harness/results/**',
      'midscene_run/**',
      'node_modules/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  {
    files: ['scripts/**/*.mjs'],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node, ...globals.worker },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['src/world/**/*.ts'],
    plugins: { seedlands },
    languageOptions: { globals: globals.node },
    rules: { 'seedlands/world-purity': 'error' },
  },
  {
    files: ['src/server/**/*.ts'],
    plugins: { seedlands },
    languageOptions: { globals: globals.node },
    rules: { 'seedlands/server-purity': 'error' },
  },
);

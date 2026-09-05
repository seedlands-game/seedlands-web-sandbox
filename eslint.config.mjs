import js from '@eslint/js';
import globals from 'globals';
import svelte from 'eslint-plugin-svelte';
import tseslint from 'typescript-eslint';

const worldForbiddenImports = (source) =>
  source === 'playcanvas' || source.includes('/server/') || source.includes('/client/');
const serverForbiddenImports = (source) => source === 'playcanvas' || source.includes('/client/');
const pureRuntimeForbiddenImports = (source, filename) =>
  source === 'playcanvas' ||
  source.includes('/app/') ||
  source.includes('/client/') ||
  source.includes('/server/') ||
  source.includes('/worker/') ||
  (filename.replaceAll('\\', '/').includes('/src/physics/') && source.includes('/runtime/'));
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
      if (source && forbiddenImport(source, context.filename))
        context.report({ node, messageId: 'forbidden', data: { dependency: source } });
    };
    return {
      ImportDeclaration: reportImport,
      ImportExpression: reportImport,
      CallExpression(node) {
        if (node.callee.type !== 'Identifier' || node.callee.name !== 'require') return;
        const [argument] = node.arguments;
        if (
          argument?.type === 'Literal' &&
          typeof argument.value === 'string' &&
          forbiddenImport(argument.value, context.filename)
        )
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
    'pure-runtime': purityRule(pureRuntimeForbiddenImports),
    'ui-presentation-boundary': {
      meta: {
        type: 'problem',
        schema: [],
        messages: { forbidden: 'Player UI 必须经 UiBridge 与 Svelte 渲染，禁止手写 DOM presentation。' },
      },
      create(context) {
        const file = context.filename.replaceAll('\\', '/');
        if (file.endsWith('/src/app/ui/mount-ui.ts')) return {};
        const forbiddenAssignments = new Set(['textContent', 'innerHTML', 'hidden']);
        const forbiddenCalls = new Set(['append', 'appendChild', 'replaceChildren']);
        return {
          AssignmentExpression(node) {
            if (
              node.left.type === 'MemberExpression' &&
              !node.left.computed &&
              node.left.property.type === 'Identifier' &&
              forbiddenAssignments.has(node.left.property.name)
            )
              context.report({ node, messageId: 'forbidden' });
          },
          CallExpression(node) {
            if (node.callee.type !== 'MemberExpression' || node.callee.computed) return;
            const property = node.callee.property;
            if (property.type !== 'Identifier') return;
            if (forbiddenCalls.has(property.name)) {
              context.report({ node, messageId: 'forbidden' });
              return;
            }
            if (property.name !== 'createElement') return;
            const object = node.callee.object;
            if (object.type !== 'Identifier' || object.name !== 'document') return;
            const [tag] = node.arguments;
            if (tag?.type === 'Literal' && tag.value === 'canvas') return;
            const parentCallee = node.parent.type === 'CallExpression' ? node.parent.callee : null;
            if (
              parentCallee?.type === 'MemberExpression' &&
              !parentCallee.computed &&
              parentCallee.property.type === 'Identifier' &&
              forbiddenCalls.has(parentCallee.property.name)
            )
              return;
            context.report({ node, messageId: 'forbidden' });
          },
        };
      },
    },
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
    files: ['**/*.{js,mjs,cjs,ts,mts,cts,svelte}'],
    linterOptions: { noInlineConfig: true },
    rules: {
      'max-lines': ['error', { max: 500, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['**/*.{ts,mts,cts}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node, ...globals.worker },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
    },
  },
  ...svelte.configs['flat/recommended'],
  {
    files: ['**/*.svelte'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
    },
  },
  {
    files: ['src/app/**/*.ts'],
    ignores: ['src/app/ui/mount-ui.ts'],
    plugins: { seedlands },
    rules: { 'seedlands/ui-presentation-boundary': 'error' },
  },
  {
    files: ['src/world/**/*.ts'],
    plugins: { seedlands },
    languageOptions: { globals: globals.node },
    rules: { 'seedlands/world-purity': 'error' },
  },
  {
    files: ['src/runtime/**/*.ts', 'src/physics/**/*.ts'],
    plugins: { seedlands },
    languageOptions: { globals: globals.node },
    rules: { 'seedlands/pure-runtime': 'error' },
  },
  {
    files: ['src/server/**/*.ts'],
    plugins: { seedlands },
    languageOptions: { globals: globals.node },
    rules: { 'seedlands/server-purity': 'error' },
  },
);

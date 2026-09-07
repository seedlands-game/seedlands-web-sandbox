import js from '@eslint/js';
import globals from 'globals';
import svelte from 'eslint-plugin-svelte';
import tseslint from 'typescript-eslint';
import { isBuiltin } from 'node:module';

const worldForbiddenImports = (source) =>
  source === 'playcanvas' ||
  source.includes('/server/') ||
  source.includes('/client/') ||
  source.includes('/compute/') ||
  source.includes('/worker/') ||
  source.includes('/app/');
const serverForbiddenImports = (source) => source === 'playcanvas' || source.includes('/client/');
const clientForbiddenImports = (source) => source.includes('/app/');
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

const purityRule = (forbiddenImport, extraGlobals = []) => ({
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
      ExportNamedDeclaration: reportImport,
      ExportAllDeclaration: reportImport,
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
        if (!forbiddenRuntimeGlobals.has(node.name) && !extraGlobals.includes(node.name)) return;
        if (node.parent.type === 'Property' && node.parent.key === node && !node.parent.computed) return;
        if (node.parent.type === 'MemberExpression' && node.parent.property === node && !node.parent.computed) return;
        context.report({ node, messageId: 'forbidden', data: { dependency: node.name } });
      },
    };
  },
});

const importBoundaryRule = (forbiddenImport) => ({
  meta: {
    type: 'problem',
    schema: [],
    messages: { forbidden: '此目录不能依赖 {{dependency}}。' },
  },
  create(context) {
    const reportImport = (node) => {
      const source = typeof node.source?.value === 'string' ? node.source.value : null;
      if (source && forbiddenImport(source, context.filename))
        context.report({ node, messageId: 'forbidden', data: { dependency: source } });
    };
    return {
      ImportDeclaration: reportImport,
      ExportNamedDeclaration: reportImport,
      ExportAllDeclaration: reportImport,
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
    };
  },
});

const topLevelOwnerRule = (allowed) => ({
  meta: {
    type: 'problem',
    schema: [],
    messages: { misplaced: '请将此文件放入已定义的职责目录，或把明确的组合入口加入 allowlist。' },
  },
  create(context) {
    const normalized = context.filename.replaceAll('\\', '/');
    const file = normalized.split('/').at(-1);
    return allowed.has(file) ? {} : { Program: (node) => context.report({ node, messageId: 'misplaced' }) };
  },
});

const seedlands = {
  rules: {
    'node-platform-boundary': {
      meta: {
        type: 'problem',
        schema: [],
        messages: { forbidden: '平台依赖 {{dependency}} 不属于当前目录；请经注入端口使用。' },
      },
      create(context) {
        const nodeAdapter = context.filename.replaceAll('\\', '/').includes('/src/node/');
        const forbiddenImport = (source) =>
          nodeAdapter
            ? source === 'playcanvas' || /(?:^|\/)(?:app|client)(?:\/|$)/.test(source)
            : source.startsWith('node:') || isBuiltin(source) || /(?:^|\/)node(?:\/|$)/.test(source);
        const imports = importBoundaryRule(forbiddenImport).create(context);
        return {
          ...imports,
          Identifier(node) {
            if (!nodeAdapter || !forbiddenRuntimeGlobals.has(node.name)) return;
            const reference = context.sourceCode.getScope(node).references.find((entry) => entry.identifier === node);
            if (reference && !reference.resolved?.defs.length)
              context.report({ node, messageId: 'forbidden', data: { dependency: node.name } });
          },
        };
      },
    },
    'world-purity': purityRule(worldForbiddenImports, ['fetch', 'WebAssembly']),
    'compute-purity': purityRule(pureRuntimeForbiddenImports, ['fetch']),
    'server-purity': purityRule(serverForbiddenImports),
    'pure-runtime': purityRule(pureRuntimeForbiddenImports),
    'authority-worker-owner': {
      meta: {
        type: 'problem',
        schema: [],
        messages: { forbidden: 'GameServer与服务端命令执行器只能由Authority Worker或headless工厂持有。' },
      },
      create(context) {
        const isGameServer = (source) =>
          typeof source === 'string' && /(?:^|\/)game-server(?:\.[cm]?[jt]s)?$/.test(source);
        const isServerCommandExecutor = (source) =>
          typeof source === 'string' &&
          /(?:^|\/)server\/commands\/server-command-executor(?:\.[cm]?[jt]s)?$/.test(source);
        const isForbiddenValueSource = (source) => isGameServer(source) || isServerCommandExecutor(source);
        const concreteGameServerTypes = new Set();
        const report = (node) => context.report({ node, messageId: 'forbidden' });
        return {
          ImportDeclaration(node) {
            if (isGameServer(node.source.value))
              for (const specifier of node.specifiers)
                if (
                  specifier.type === 'ImportSpecifier' &&
                  specifier.imported.type === 'Identifier' &&
                  specifier.imported.name === 'GameServer'
                )
                  concreteGameServerTypes.add(specifier.local.name);
            if (!isForbiddenValueSource(node.source.value) || node.importKind === 'type') return;
            if (node.specifiers.length > 0 && node.specifiers.every((specifier) => specifier.importKind === 'type'))
              return;
            report(node);
          },
          ImportExpression(node) {
            if (node.source.type === 'Literal' && isForbiddenValueSource(node.source.value)) report(node);
          },
          CallExpression(node) {
            if (node.callee.type !== 'Identifier' || node.callee.name !== 'require') return;
            const [argument] = node.arguments;
            if (argument?.type === 'Literal' && isForbiddenValueSource(argument.value)) report(node);
          },
          TSTypeReference(node) {
            if (node.typeName.type === 'Identifier' && concreteGameServerTypes.has(node.typeName.name)) report(node);
          },
        };
      },
    },
    'client-no-app-import': importBoundaryRule(clientForbiddenImports),
    'app-top-level-owner': topLevelOwnerRule(
      new Set([
        'app-contracts.ts',
        'application-shell.ts',
        'authority-presentation-sync.ts',
        'browser-session-config.ts',
        'browser-worker-session.ts',
        'bootstrap.ts',
        'client-capability-preflight.ts',
        'command-history.ts',
        'game-harness.ts',
        'game-frame-loop.ts',
        'game-runtime-controls.ts',
        'game-ui-projection.ts',
        'game.ts',
        'hud-projector.ts',
        'macro-map-renderer.ts',
        'main.ts',
      ]),
    ),
    'client-top-level-owner': topLevelOwnerRule(
      new Set([
        'build-watermark.ts',
        'client-ready-wait.ts',
        'experimental-client-options.ts',
        'client-request-registry.ts',
        'local-player-prediction.ts',
        'player-input-stream.ts',
        'prediction-buffer.ts',
        'snapshot-interpolator.ts',
        'world-version-policy.ts',
      ]),
    ),
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
      'wasm/**/_build/**',
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
    rules: {
      'seedlands/ui-presentation-boundary': 'error',
      'seedlands/authority-worker-owner': 'error',
    },
  },
  {
    files: ['src/app/*.{ts,svelte}'],
    ignores: ['src/app/player-view-offsets.ts'],
    plugins: { seedlands },
    rules: { 'seedlands/app-top-level-owner': 'error' },
  },
  {
    files: ['src/client/*.ts'],
    ignores: ['src/client/performance-telemetry.ts'],
    plugins: { seedlands },
    rules: { 'seedlands/client-top-level-owner': 'error' },
  },
  {
    files: ['src/client/**/*.ts'],
    plugins: { seedlands },
    rules: {
      'seedlands/authority-worker-owner': 'error',
      'seedlands/client-no-app-import': 'error',
    },
  },
  {
    files: ['src/world/**/*.ts'],
    plugins: { seedlands },
    languageOptions: { globals: globals.node },
    rules: { 'seedlands/world-purity': 'error' },
  },
  {
    files: ['src/compute/**/*.ts'],
    plugins: { seedlands },
    rules: { 'seedlands/compute-purity': 'error' },
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
  {
    files: ['src/**/*.ts'],
    plugins: { seedlands },
    rules: { 'seedlands/node-platform-boundary': 'error' },
  },
  {
    files: ['src/node/**/*.ts'],
    languageOptions: {
      globals: {
        ...Object.fromEntries(Object.keys({ ...globals.browser, ...globals.worker }).map((name) => [name, 'off'])),
        ...globals.node,
      },
    },
  },
);

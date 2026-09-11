import { isBuiltin } from 'node:module';
import { createPackageBoundaryRule } from './package-boundary-rule.mjs';
import { packApiBoundaryRule } from './pack-api-boundary-rule.mjs';

export function createSeedlandsPlugin(workspaceRoot) {
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
  const computeForbiddenImports = (source) =>
    source === 'playcanvas' ||
    source === '@seedlands/stdlib' ||
    source.startsWith('@seedlands/stdlib/') ||
    source.startsWith('@seedlands/playbook-') ||
    source.startsWith('node:') ||
    isBuiltin(source) ||
    /(?:^|\/)(?:app|client|node)(?:\/|$)/.test(source) ||
    /(?:^|\/)(?:gameplay|playbooks?)(?:[-/]|$)/.test(source);
  const forbiddenRuntimeGlobals = new Set([
    'window',
    'document',
    'requestAnimationFrame',
    'self',
    'postMessage',
    'Worker',
  ]);
  const forbiddenKernelGlobals = [
    'BroadcastChannel',
    'Buffer',
    'Document',
    'HTMLElement',
    'MessageChannel',
    'MessagePort',
    'Navigator',
    'NodeJS',
    'WebAssembly',
    'WebSocket',
    'Window',
    'XMLHttpRequest',
    '__dirname',
    '__filename',
    'clearImmediate',
    'exports',
    'fetch',
    'global',
    'indexedDB',
    'localStorage',
    'module',
    'process',
    'require',
    'sessionStorage',
    'setImmediate',
  ];

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
        TSImportType: reportImport,
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
          if (
            (node.parent.type === 'TSPropertySignature' || node.parent.type === 'TSMethodSignature') &&
            node.parent.key === node &&
            !node.parent.computed
          )
            return;
          if (node.parent.type === 'MemberExpression' && node.parent.property === node && !node.parent.computed) return;
          if (node.name === 'require' && node.parent.type === 'CallExpression' && node.parent.callee === node) {
            const [argument] = node.parent.arguments;
            if (argument?.type === 'Literal' && typeof argument.value === 'string' && forbiddenImport(argument.value))
              return;
          }
          const reference = context.sourceCode.getScope(node).references.find((entry) => entry.identifier === node);
          if (!reference || reference.resolved?.defs.length) return;
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
        TSImportType: reportImport,
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

  return {
    rules: {
      'pack-api-boundary': packApiBoundaryRule,
      'package-boundary': createPackageBoundaryRule(workspaceRoot),
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
      'core-compute-purity': purityRule(computeForbiddenImports, forbiddenKernelGlobals),
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
}

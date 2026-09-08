import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isBuiltin } from 'node:module';

const normalize = (value) => value.replaceAll('\\', '/').replace(/\/$/, '');
const within = (file, root) => file === root || file.startsWith(`${root}/`);
const dependencyName = (source) =>
  source.startsWith('@') ? source.split('/').slice(0, 2).join('/') : source.split('/')[0];
const workspaceName = (source) => (source.startsWith('@seedlands/') ? dependencyName(source) : null);

const exportAllows = (exports, source, packageName) => {
  if (!exports || typeof exports !== 'object') return false;
  const suffix = source.slice(packageName.length);
  const requested = suffix ? `.${suffix}` : '.';
  return Object.keys(exports).some((pattern) => {
    if (!pattern.includes('*')) return pattern === requested;
    const [prefix, tail] = pattern.split('*');
    return requested.startsWith(prefix) && requested.endsWith(tail);
  });
};

export function createPackageBoundaryRule(workspaceRoot) {
  const packageDefinitions = [
    ['@seedlands/web', 'apps/web'],
    ['@seedlands/node-server', 'apps/node-server'],
    ['@seedlands/game-core', 'packages/game-core'],
  ].map(([name, relativeRoot]) => {
    const root = normalize(resolve(workspaceRoot, relativeRoot));
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
    return { name, root, dependencies: manifest.dependencies ?? {}, exports: manifest.exports ?? {} };
  });
  const packageByName = new Map(packageDefinitions.map((entry) => [entry.name, entry]));
  const ownerOf = (path) => packageDefinitions.find((entry) => within(normalize(path), entry.root));
  const allowedWorkspaceDirection = (owner, target) =>
    owner.name === target.name || target.name === '@seedlands/game-core';

  return {
    meta: {
      type: 'problem',
      schema: [],
      messages: {
        crossRelative: '跨 workspace 包禁止文件路径导入 {{dependency}}；请使用声明的 package export。',
        forbiddenDirection: '{{owner}} 禁止依赖 {{dependency}}。',
        undeclared: '{{owner}} 的 dependencies 未声明 {{dependency}}。',
        unexported: '{{dependency}} 不是目标包声明的 export。',
      },
    },
    create(context) {
      const owner = ownerOf(context.filename);
      if (!owner) return {};
      const reportSource = (node, source) => {
        if (source.startsWith('.') || isAbsolute(source) || source.startsWith('file:')) {
          let targetPath;
          try {
            targetPath = source.startsWith('file:') ? fileURLToPath(source) : resolve(context.filename, '..', source);
          } catch {
            return;
          }
          const target = ownerOf(targetPath);
          if (target && target.name !== owner.name)
            context.report({ node, messageId: 'crossRelative', data: { dependency: source } });
          return;
        }
        if (source.startsWith('#')) return;
        const dependency = dependencyName(source);
        if (isBuiltin(source) || isBuiltin(dependency)) return;
        const targetName = workspaceName(source);
        if (targetName) {
          const target = packageByName.get(targetName);
          if (!target || !(targetName in owner.dependencies)) {
            context.report({ node, messageId: 'undeclared', data: { owner: owner.name, dependency: targetName } });
            return;
          }
          if (!allowedWorkspaceDirection(owner, target)) {
            context.report({
              node,
              messageId: 'forbiddenDirection',
              data: { owner: owner.name, dependency: targetName },
            });
            return;
          }
          if (!exportAllows(target.exports, source, targetName))
            context.report({ node, messageId: 'unexported', data: { dependency: source } });
          return;
        }
        if (!(dependency in owner.dependencies))
          context.report({ node, messageId: 'undeclared', data: { owner: owner.name, dependency } });
      };
      const reportImport = (node) => {
        const source = typeof node.source?.value === 'string' ? node.source.value : null;
        if (source) reportSource(node, source);
      };
      return {
        ImportDeclaration: reportImport,
        ExportNamedDeclaration: reportImport,
        ExportAllDeclaration: reportImport,
        ImportExpression: reportImport,
        CallExpression(node) {
          if (node.callee.type !== 'Identifier' || node.callee.name !== 'require') return;
          const [argument] = node.arguments;
          if (argument?.type === 'Literal' && typeof argument.value === 'string') reportSource(node, argument.value);
        },
      };
    },
  };
}

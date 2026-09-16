import { existsSync, readFileSync, readdirSync } from 'node:fs';
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
  const retiredNodeRoot = normalize(resolve(workspaceRoot, 'apps/node-server'));
  const roots = ['apps', 'packages', 'playbooks'].flatMap((directory) => {
    const parent = resolve(workspaceRoot, directory);
    return existsSync(parent)
      ? readdirSync(parent, { withFileTypes: true })
          .filter((entry) => entry.isDirectory() && existsSync(resolve(parent, entry.name, 'package.json')))
          .map((entry) => `${directory}/${entry.name}`)
      : [];
  });
  const packageDefinitions = roots.map((relativeRoot) => {
    const root = normalize(resolve(workspaceRoot, relativeRoot));
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
    return { name: manifest.name, root, dependencies: manifest.dependencies ?? {}, exports: manifest.exports ?? {} };
  });
  const packageByName = new Map(packageDefinitions.map((entry) => [entry.name, entry]));
  const ownerOf = (path) => packageDefinitions.find((entry) => within(normalize(path), entry.root));
  const allowedWorkspaceDirection = (owner, target) => {
    if (owner.name === target.name) return true;
    if (owner.name === '@seedlands/kernel') return false;
    if (owner.name === '@seedlands/stdlib') return target.name === '@seedlands/kernel';
    if (owner.name.startsWith('@seedlands/playbook-'))
      return ['@seedlands/kernel', '@seedlands/stdlib'].includes(target.name);
    if (owner.name === '@seedlands/cognition-protocol')
      return ['@seedlands/kernel', '@seedlands/stdlib'].includes(target.name);
    return [
      '@seedlands/kernel',
      '@seedlands/stdlib',
      '@seedlands/cognition-protocol',
      '@seedlands/playbook-classic',
    ].includes(target.name);
  };

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
          if (within(normalize(targetPath), retiredNodeRoot)) {
            context.report({
              node,
              messageId: 'forbiddenDirection',
              data: { owner: owner.name, dependency: '@seedlands/node-server' },
            });
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
          if (!target || (targetName !== owner.name && !(targetName in owner.dependencies))) {
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
        TSImportType(node) {
          const source = node.source?.value;
          if (typeof source === 'string') reportSource(node, source);
        },
        CallExpression(node) {
          if (node.callee.type !== 'Identifier' || node.callee.name !== 'require') return;
          const [argument] = node.arguments;
          if (argument?.type === 'Literal' && typeof argument.value === 'string') reportSource(node, argument.value);
        },
      };
    },
  };
}

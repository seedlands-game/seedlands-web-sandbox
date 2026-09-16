import path from 'node:path';

const normalized = (value) => value.replaceAll('\\', '/');
const playbookRoot = (filename) => {
  const match = normalized(filename).match(/^(.*\/playbooks\/[^/]+\/src)(?:\/|$)/u);
  return match?.[1] ?? null;
};

/** A Playbook may use its own files and declared public module exports, never another package's internals. */
export const packApiBoundaryRule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: { forbidden: 'Playbook 只能导入本 Playbook 文件或 @seedlands/kernel、@seedlands/stdlib 的公开 API。' },
  },
  create(context) {
    const filename = normalized(context.filename);
    const root = playbookRoot(filename);
    if (!root) return {};
    const allowed = (source) => {
      if (typeof source !== 'string') return false;
      if (source.startsWith('.')) {
        const target = normalized(path.resolve(path.dirname(filename), source));
        return target === root || target.startsWith(`${root}/`);
      }
      if (source.split('/').includes('..')) return false;
      if (source === '@seedlands/kernel' || source.startsWith('@seedlands/kernel/')) return true;
      return source === '@seedlands/stdlib' || source.startsWith('@seedlands/stdlib/');
    };
    const inspect = (node, source) => {
      if (!allowed(source)) context.report({ node, messageId: 'forbidden' });
    };
    const declaration = (node) => {
      if (typeof node.source?.value === 'string') inspect(node, node.source.value);
    };
    return {
      ImportDeclaration: declaration,
      ExportNamedDeclaration: declaration,
      ExportAllDeclaration: declaration,
      ImportExpression(node) {
        if (node.source.type === 'Literal' && typeof node.source.value === 'string') inspect(node, node.source.value);
        else context.report({ node, messageId: 'forbidden' });
      },
      TSImportType(node) {
        const source = node.source?.value;
        if (typeof source === 'string') inspect(node, source);
        else context.report({ node, messageId: 'forbidden' });
      },
      CallExpression(node) {
        if (node.callee.type !== 'Identifier' || node.callee.name !== 'require') return;
        const [argument] = node.arguments;
        if (argument?.type === 'Literal' && typeof argument.value === 'string') inspect(node, argument.value);
        else context.report({ node, messageId: 'forbidden' });
      },
    };
  },
};

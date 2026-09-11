import path from 'node:path';

/** Standard Playbooks and Pack fixtures consume only the reviewed mod facade. */
export const packApiBoundaryRule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: { forbidden: 'Pack 只能通过 @seedlands/game-core/mod-api 消费内核，或导入本 Pack 文件。' },
  },
  create(context) {
    const filename = context.filename.replaceAll('\\', '/');
    const marker = '/server/gameplay/playbooks/';
    const examples = [
      '/changes/2026-09-09-composable-overworld-playbook/examples/',
      '/changes/2026-09-10-npc-composable-baseline/examples/',
    ].find((prefix) => filename.includes(prefix));
    const offset = filename.indexOf(marker);
    const exampleOffset = examples ? filename.indexOf(examples) : -1;
    if (offset < 0 && exampleOffset < 0) return {};
    const base = filename.slice(0, offset + marker.length);
    const root =
      examples && exampleOffset >= 0
        ? path.resolve(filename.slice(0, exampleOffset + examples.length))
        : path.resolve(base, filename.slice(base.length).split('/')[0]);
    const allowed = (source) => {
      if (typeof source !== 'string') return false;
      if (source === '@seedlands/game-core/mod-api') return true;
      if (!source.startsWith('.')) return false;
      const target = path.resolve(path.dirname(filename), source);
      return target.startsWith(`${root}${path.sep}`);
    };
    const inspect = (node, source) => {
      if (!allowed(source)) context.report({ node, messageId: 'forbidden' });
    };
    const declaration = (node) => {
      if (node.source) inspect(node, node.source.value);
    };
    return {
      ImportDeclaration: declaration,
      ExportNamedDeclaration: declaration,
      ExportAllDeclaration: declaration,
      ImportExpression: (node) => inspect(node, node.source.value),
      TSImportType: (node) => inspect(node, node.source?.value),
      CallExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'require')
          inspect(node, node.arguments[0]?.value);
      },
    };
  },
};

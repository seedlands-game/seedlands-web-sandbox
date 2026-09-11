import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { relative, resolve, dirname } from 'node:path';
import ts from 'typescript';
const root = resolve(import.meta.dirname, '../../..');
const list = (dir) =>
  readdirSync(resolve(root, dir), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? list(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`],
  );
const moves = JSON.parse(
  readFileSync(resolve(root, 'changes/2026-09-11-kernel-modules-playbooks-harness/test-owner-map.json'), 'utf8'),
);
const oldBasenames = new Set(Object.keys(moves).map((path) => path.split('/').at(-1)));
const changed = [];
const consumers = new Set();
for (const path of list('apps/web/tests/integration/runtime')) {
  if (!path.endsWith('.test.ts') || !oldBasenames.has(path.split('/').at(-1))) continue;
  let text = readFileSync(resolve(root, path), 'utf8');
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const edits = [];
  for (const node of source.statements) {
    if (
      !ts.isImportDeclaration(node) ||
      !ts.isStringLiteral(node.moduleSpecifier) ||
      !node.importClause?.namedBindings ||
      !ts.isNamedImports(node.importClause.namedBindings)
    )
      continue;
    const module = node.moduleSpecifier.text;
    const names = module.endsWith('/combat-runtime')
      ? ['CombatRuntime', 'listMeleeDefinitions', 'getMeleeDefinition']
      : module.endsWith('/autonomy-runtime')
        ? ['AutonomyRuntime']
        : module.endsWith('/player-state')
          ? ['createPlayerState']
          : module.endsWith('/game-server')
            ? ['GameServer']
            : module.endsWith('/gameplay-runtime')
              ? ['GameplayRuntime']
              : [];
    const elements = node.importClause.namedBindings.elements;
    if (
      module.endsWith('/fixtures/classic/content') &&
      elements.some((element) =>
        [
          'GameServer',
          'GameplayRuntime',
          'CombatRuntime',
          'AutonomyRuntime',
          'createPlayerState',
          'listMeleeDefinitions',
          'getMeleeDefinition',
        ].includes(element.propertyName?.text ?? element.name.text),
      )
    )
      consumers.add(path);
    const selected = elements.filter(
      (element) =>
        !element.isTypeOnly &&
        !node.importClause.isTypeOnly &&
        names.includes(element.propertyName?.text ?? element.name.text),
    );
    if (!selected.length) continue;
    const retained = elements.filter((element) => !selected.includes(element));
    let target = relative(dirname(path), 'apps/web/tests/fixtures/classic/content').replaceAll('\\', '/');
    if (!target.startsWith('.')) target = `./${target}`;
    const replacement =
      (retained.length
        ? `import { ${retained.map((element) => element.getText(source)).join(', ')} } from '${module}';\n`
        : '') + `import { ${selected.map((element) => element.getText(source)).join(', ')} } from '${target}';`;
    edits.push({ start: node.getStart(source), end: node.getEnd(), replacement });
  }
  if (edits.length) {
    for (const edit of edits.reverse()) text = text.slice(0, edit.start) + edit.replacement + text.slice(edit.end);
    writeFileSync(resolve(root, path), text);
    changed.push(path);
  }
}
writeFileSync(
  new URL('../complete-classic-runtime-fixtures.json', import.meta.url),
  JSON.stringify(
    {
      reason:
        'Frozen-base uncomposed tests explicitly select Classic content and executable provider, while explicitly supplied compositions remain unchanged. Assertions preserved.',
      files: [...new Set([...changed, ...consumers])].sort(),
    },
    null,
    2,
  ) + '\n',
);
console.log(`${changed.length} legacy runtime fixtures made explicit.`);

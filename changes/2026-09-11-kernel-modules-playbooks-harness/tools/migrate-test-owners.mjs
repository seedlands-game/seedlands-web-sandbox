import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, posix, resolve } from 'node:path';
import ts from 'typescript';
const root = resolve(import.meta.dirname, '../../..');
const list = (directory) =>
  readdirSync(resolve(root, directory), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? list(`${directory}/${entry.name}`) : [`${directory}/${entry.name}`],
  );
const files = list('tests');
const oldPaths = new Set([
  ...execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).trim().split('\n'),
  ...files,
]);
const map = new Map();
for (const file of files) {
  let target;
  if (file.startsWith('tests/e2e/'))
    target = file.endsWith('.spec.ts')
      ? file.replace('tests/e2e/', 'changes/2026-09-11-kernel-modules-playbooks-harness/legacy-e2e/')
      : file.replace('tests/', 'apps/web/tests/');
  else if (file.startsWith('tests/agent-server/'))
    target = file.replace('tests/agent-server/', 'apps/agent-server/tests/');
  else if (/^tests\/(app|client|worker)\//.test(file)) target = file.replace('tests/', 'apps/web/tests/unit/');
  else if (file.startsWith('tests/scripts/'))
    target = file.replace('tests/scripts/', 'apps/web/tests/integration/engineering/');
  else if (file.startsWith('tests/governance/'))
    target = /eslint|pack-api-(boundary|consumer)|monorepo-package-boundaries|svelte-ui-boundary/.test(file)
      ? file.replace('tests/governance/', 'packages/eslint-plugin/tests/')
      : file.replace('tests/governance/', 'apps/web/tests/integration/architecture/');
  else target = file.replace('tests/', 'packages/stdlib/tests/');
  map.set(file, target);
}
function relocate(path) {
  if (map.has(path)) return map.get(path);
  const playbook = 'packages/game-core/src/server/gameplay/playbooks/overworld/';
  if (path.startsWith(playbook)) return path.replace(playbook, 'playbooks/classic/src/');
  if (path.startsWith('packages/game-core/')) return path.replace('packages/game-core/', 'packages/stdlib/');
  if (path.startsWith('scripts/eslint/')) return path.replace('scripts/eslint/', 'packages/eslint-plugin/src/');
  return path;
}
for (const [file, target] of map) {
  let contents = readFileSync(resolve(root, file), 'utf8');
  if (!target.includes('/legacy-e2e/')) {
    const source = ts.createSourceFile(file, contents, ts.ScriptTarget.Latest, true);
    const edits = [];
    function visit(node) {
      let literal;
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) literal = node.moduleSpecifier;
      else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) literal = node.argument.literal;
      else if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
      )
        literal = node.arguments[0];
      else if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'URL')
        literal = node.arguments?.[0];
      if (literal && ts.isStringLiteralLike(literal)) {
        let name = literal.text;
        if (name.startsWith('.')) {
          const absolute = posix.normalize(posix.join(posix.dirname(file), name));
          const resolved = [absolute, `${absolute}.ts`, `${absolute}.mjs`, `${absolute}/index.ts`].find((p) =>
            oldPaths.has(p),
          );
          const actual = resolved ?? absolute;
          let changed = relocate(actual);
          if (resolved && resolved !== absolute && !name.endsWith('.ts') && !name.endsWith('.mjs'))
            changed = changed.replace(/(?:\/index)?\.(?:ts|mjs)$/, '');
          name = posix.relative(posix.dirname(target), changed);
          if (!name.startsWith('.')) name = `./${name}`;
        } else if (name.startsWith('@seedlands/game-core')) {
          name = name
            .replace('@seedlands/game-core/server/composition/host-api', '@seedlands/stdlib/host')
            .replace('@seedlands/game-core', '@seedlands/stdlib');
        }
        if (name !== literal.text)
          edits.push({ start: literal.getStart(source) + 1, end: literal.getEnd() - 1, value: name });
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    for (const edit of edits.sort((a, b) => b.start - a.start))
      contents = contents.slice(0, edit.start) + edit.value + contents.slice(edit.end);
  }
  mkdirSync(dirname(resolve(root, target)), { recursive: true });
  renameSync(resolve(root, file), resolve(root, target));
  writeFileSync(resolve(root, target), contents);
}
writeFileSync(
  resolve(root, 'changes/2026-09-11-kernel-modules-playbooks-harness/test-owner-map.json'),
  `${JSON.stringify(Object.fromEntries(map), null, 2)}\n`,
);
console.log(`Moved ${map.size} test/support files; old browser spec bytes retained as historical source.`);

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, posix } from 'node:path';
import ts from 'typescript';
const root = resolve(import.meta.dirname, '../../..');
const list = (d) =>
  readdirSync(resolve(root, d), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? list(`${d}/${e.name}`) : [`${d}/${e.name}`],
  );
const changed = [];
for (const path of [...list('packages/stdlib/tests'), ...list('packages/stdlib/benchmarks')]) {
  if (!path.endsWith('.test.ts')) continue;
  let text = readFileSync(resolve(root, path), 'utf8');
  const ast = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const edits = [];
  function visit(n) {
    if (
      ts.isNewExpression(n) &&
      n.expression.getText(ast) === 'GameServer' &&
      n.arguments?.[0] &&
      ts.isObjectLiteralExpression(n.arguments[0])
    ) {
      const o = n.arguments[0];
      if (!o.properties.some((p) => ['worldgenProvider', 'composition'].includes(p.name?.getText(ast))))
        edits.push({ start: o.getStart(ast) + 1, value: ' worldgenProvider: testWorldgenExecutableProvider,' });
    }
    ts.forEachChild(n, visit);
  }
  visit(ast);
  if (!edits.length) continue;
  for (const e of edits.sort((a, b) => b.start - a.start))
    text = text.slice(0, e.start) + e.value + text.slice(e.start);
  const imported = ast.statements.some(
    (s) =>
      ts.isImportDeclaration(s) &&
      s.importClause?.namedBindings &&
      ts.isNamedImports(s.importClause.namedBindings) &&
      s.importClause.namedBindings.elements.some((e) => e.name.text === 'testWorldgenExecutableProvider'),
  );
  if (!imported) {
    let target = posix.relative(posix.dirname(path), 'packages/stdlib/tests/support/worldgen');
    if (!target.startsWith('.')) target = './' + target;
    text = `import { testWorldgenExecutableProvider } from '${target}';\n` + text;
  }
  writeFileSync(resolve(root, path), text);
  changed.push(path);
}
writeFileSync(
  resolve(root, 'changes/2026-09-11-kernel-modules-playbooks-harness/executable-provider-test-map.json'),
  JSON.stringify(
    {
      reason:
        'Base pure-world fixtures explicitly select the same standard generator; missing-provider negative fixtures are authored separately.',
      files: changed,
    },
    null,
    2,
  ) + '\n',
);
console.log(changed.join('\n'));

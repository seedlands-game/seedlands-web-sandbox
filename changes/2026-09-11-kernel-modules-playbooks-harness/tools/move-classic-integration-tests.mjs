import { readdirSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { posix, resolve, dirname } from 'node:path';
import ts from 'typescript';
const root = resolve(import.meta.dirname, '../../..');
const list = (dir) =>
  readdirSync(resolve(root, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? list(`${dir}/${e.name}`) : [`${dir}/${e.name}`],
  );
const all = [...list('packages/stdlib/tests'), ...list('apps/web/tests'), ...list('apps/agent-server/tests')].filter(
  (p) => p.endsWith('.ts'),
);
const mapPath = resolve(root, 'changes/2026-09-11-kernel-modules-playbooks-harness/classic-integration-test-map.json');
const prior = JSON.parse(readFileSync(mapPath, 'utf8'));
const classicFiles = new Set();
const dependencies = new Map();
for (const path of all) {
  const source = ts.createSourceFile(path, readFileSync(resolve(root, path), 'utf8'), ts.ScriptTarget.Latest, true);
  const local = new Set();
  for (const node of source.statements) {
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) continue;
    const specifier = node.moduleSpecifier.text;
    const target = specifier.startsWith('.') ? posix.normalize(posix.join(posix.dirname(path), specifier)) : specifier;
    if (
      target.startsWith('playbooks/classic/') ||
      target.startsWith('@seedlands/playbook-classic') ||
      target.startsWith('apps/web/tests/fixtures/classic/')
    )
      classicFiles.add(path);
    local.add(target.endsWith('.ts') ? target : target + '.ts');
  }
  dependencies.set(path, local);
}
let grew = true;
while (grew) {
  grew = false;
  for (const [path, inputs] of dependencies) {
    if (!classicFiles.has(path) && [...inputs].some((input) => classicFiles.has(input))) {
      classicFiles.add(path);
      grew = true;
    }
  }
}
const additions = [...classicFiles]
  .filter((path) => path.startsWith('packages/stdlib/tests/'))
  .map((path) => [
    path,
    path.includes('/support/')
      ? path.replace('packages/stdlib/tests/support/', 'apps/web/tests/fixtures/classic/')
      : path.replace('packages/stdlib/tests/', 'apps/web/tests/integration/runtime/'),
  ]);
const map = new Map([...Object.entries(prior), ...additions]);
for (const path of all) {
  const target = map.get(path) ?? path;
  let text = readFileSync(resolve(root, path), 'utf8');
  const ast = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const edits = [];
  function visit(node) {
    let value;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) value = node.moduleSpecifier;
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) value = node.argument.literal;
    else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
      value = node.arguments[0];
    else if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'URL')
      value = node.arguments?.[0];
    if (value && ts.isStringLiteralLike(value) && value.text.startsWith('.')) {
      const absolute = posix.normalize(posix.join(posix.dirname(path), value.text));
      const old = map.has(absolute) ? absolute : map.has(absolute + '.ts') ? absolute + '.ts' : absolute;
      let next = map.get(old) ?? old;
      if (old !== absolute) next = next.replace(/\.ts$/, '');
      let name = posix.relative(posix.dirname(target), next);
      if (!name.startsWith('.')) name = './' + name;
      if (value.text.endsWith('/') && !name.endsWith('/')) name += '/';
      if (name !== value.text) edits.push({ start: value.getStart(ast) + 1, end: value.getEnd() - 1, value: name });
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  for (const edit of edits.sort((a, b) => b.start - a.start))
    text = text.slice(0, edit.start) + edit.value + text.slice(edit.end);
  if (target !== path) {
    mkdirSync(dirname(resolve(root, target)), { recursive: true });
    renameSync(resolve(root, path), resolve(root, target));
  }
  if (edits.length || target !== path) writeFileSync(resolve(root, target), text);
}
writeFileSync(mapPath, JSON.stringify(Object.fromEntries(map), null, 2) + '\n');
console.log(`Recorded ${map.size} Classic-content integration test moves (${additions.length} new).`);

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, posix } from 'node:path';
import ts from 'typescript';
const root = resolve(import.meta.dirname, '../../..');
const list = (d) =>
  readdirSync(resolve(root, d), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? list(`${d}/${e.name}`) : [`${d}/${e.name}`],
  );
const editsLog = [];
for (const path of [
  ...list('packages/stdlib/tests'),
  ...list('apps/web/tests/unit/worker'),
  ...list('apps/web/tests/unit/app'),
  ...list('apps/web/tests/integration/runtime'),
]) {
  if (!path.endsWith('.ts') || path.includes('/migration-') || path.endsWith('/authority-starter-ecology.test.ts'))
    continue;
  let text = readFileSync(resolve(root, path), 'utf8');
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const edits = [],
    imports = new Map();
  const ensure = (name, target) => {
    if (text.includes(`import { ${name}`)) return;
    let relative = posix.relative(posix.dirname(path), target);
    if (!relative.startsWith('.')) relative = './' + relative;
    imports.set(name, relative);
  };
  function visit(node) {
    if (ts.isObjectLiteralExpression(node)) {
      const has = (name) =>
        node.properties.some(
          (p) => p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === name,
        );
      const kind = node.properties.find((p) => ts.isPropertyAssignment(p) && p.name.getText(source) === 'kind');
      const kindValue = kind && (ts.isAsExpression(kind.initializer) ? kind.initializer.expression : kind.initializer);
      if (
        kindValue &&
        ts.isStringLiteral(kindValue) &&
        (['find-safe-spawn', 'generate-canonical'].includes(kindValue.text) ||
          (kindValue.text === 'generate-mesh' && !has('canonical') && !has('inputStrategy'))) &&
        !has('provider')
      ) {
        ensure('testWorldgenProvider', 'packages/stdlib/tests/support/worldgen');
        edits.push({
          start: node.getStart(source) + 1,
          end: node.getStart(source) + 1,
          value: ` provider: testWorldgenProvider,${kindValue.text === 'find-safe-spawn' && !has('starterEcology') ? ' starterEcology: null,' : ''}`,
        });
      }
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(source) === 'HeadlessSession.create' &&
      node.arguments[0] &&
      ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      const input = node.arguments[0];
      if (!input.properties.some((p) => p.name?.getText(source) === 'createComposition')) {
        ensure('createClassicComposition', 'apps/web/tests/fixtures/classic/content');
        edits.push({
          start: input.getStart(source) + 1,
          end: input.getStart(source) + 1,
          value: ' createComposition: createClassicComposition,',
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (edits.length) {
    for (const e of edits.sort((a, b) => b.start - a.start))
      text = text.slice(0, e.start) + e.value + text.slice(e.end);
    for (const [name, target] of imports) text = `import { ${name} } from '${target}';\n` + text;
    writeFileSync(resolve(root, path), text);
    editsLog.push(path);
  }
}
writeFileSync(
  resolve(root, 'changes/2026-09-11-kernel-modules-playbooks-harness/explicit-provider-test-map.json'),
  JSON.stringify(editsLog, null, 2) + '\n',
);
console.log(`Updated explicit input in ${editsLog.length} tests.`);

import { readdirSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, posix, resolve } from 'node:path';
import ts from 'typescript';
const root = resolve(import.meta.dirname, '../../..');
const map = Object.fromEntries(
  [
    'app/companion-checkpoint-recovery.test.ts',
    'app/melee-action-showcase.test.ts',
    'client/application-checkpoint.test.ts',
    'client/browser-character-authority.test.ts',
  ].map((p) => [`apps/web/tests/unit/${p}`, `apps/web/tests/integration/runtime/${p}`]),
);
const list = (dir) =>
  readdirSync(resolve(root, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? list(`${dir}/${e.name}`) : [`${dir}/${e.name}`],
  );
for (const path of list('apps/web/tests').filter((p) => p.endsWith('.ts'))) {
  const target = map[path] ?? path;
  let text = readFileSync(resolve(root, path), 'utf8');
  const ast = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const edits = [];
  function visit(node) {
    let v;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) v = node.moduleSpecifier;
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) v = node.argument.literal;
    else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isPropertyAccessExpression(node.expression) &&
          ['mock', 'doMock', 'unmock', 'doUnmock'].includes(node.expression.name.text)))
    )
      v = node.arguments[0];
    else if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'URL')
      v = node.arguments?.[0];
    if (v && ts.isStringLiteralLike(v) && v.text.startsWith('.')) {
      const absolute = posix.normalize(posix.join(posix.dirname(path), v.text));
      const referenced = map[absolute] ? absolute : map[absolute + '.ts'] ? absolute + '.ts' : absolute;
      let next = map[referenced] ?? referenced;
      if (referenced !== absolute) next = next.replace(/\.ts$/, '');
      let result = posix.relative(posix.dirname(target), next);
      if (!result.startsWith('.')) result = './' + result;
      if (v.text.endsWith('/') && !result.endsWith('/')) result += '/';
      if (result !== v.text) edits.push({ start: v.getStart(ast) + 1, end: v.getEnd() - 1, result });
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  for (const e of edits.sort((a, b) => b.start - a.start)) text = text.slice(0, e.start) + e.result + text.slice(e.end);
  if (target !== path) {
    mkdirSync(dirname(resolve(root, target)), { recursive: true });
    renameSync(resolve(root, path), resolve(root, target));
  }
  if (edits.length || target !== path) writeFileSync(resolve(root, target), text);
}
writeFileSync(
  resolve(root, 'changes/2026-09-11-kernel-modules-playbooks-harness/web-runtime-test-map.json'),
  JSON.stringify(map, null, 2) + '\n',
);

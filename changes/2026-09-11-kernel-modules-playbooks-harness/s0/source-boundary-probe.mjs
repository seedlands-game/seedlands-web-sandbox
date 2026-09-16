// Read-only pre-migration RED: can the current generic Pack entry load without gameplay?
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '../../..');
const entry = resolve(root, 'packages/game-core/src/server/composition/assembly.ts');
const seen = new Set();
const imports = [];
const unresolved = [];
const coreRoot = resolve(root, 'packages/game-core');
const { exports: coreExports } = JSON.parse(readFileSync(resolve(coreRoot, 'package.json'), 'utf8'));
function packagePath(name) {
  const subpath = `./${name.slice('@seedlands/game-core/'.length)}`;
  if (typeof coreExports[subpath] === 'string') return resolve(coreRoot, coreExports[subpath]);
  for (const [pattern, target] of Object.entries(coreExports)) {
    if (pattern.endsWith('*') && subpath.startsWith(pattern.slice(0, -1)) && typeof target === 'string')
      return resolve(coreRoot, target.replace('*', subpath.slice(pattern.length - 1)));
  }
  return null;
}
function walk(file) {
  if (seen.has(file)) return;
  seen.add(file);
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  function visit(node) {
    let specifier;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier;
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) specifier = node.argument.literal;
    else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    )
      specifier = node.arguments[0];
    if (specifier && ts.isStringLiteralLike(specifier)) {
      const name = specifier.text;
      const base = name.startsWith('.')
        ? resolve(dirname(file), name)
        : name.startsWith('@seedlands/game-core/')
          ? packagePath(name)
          : null;
      if (base) {
        const target = [base, `${base}.ts`, resolve(base, 'index.ts')].find(
          (path) => existsSync(path) && /\.ts$/.test(path),
        );
        if (!target) unresolved.push({ file: relative(root, file), name });
        else {
          imports.push({
            from: relative(root, file),
            to: relative(root, target),
            line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
          });
          walk(target);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}
walk(entry);
const forbidden = [...seen]
  .map((path) => relative(root, path))
  .filter((path) => /\/server\/(gameplay|simulation)\//.test(path));
const receipt = {
  schemaVersion: 1,
  sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  entry: relative(root, entry),
  boundary: 'Generic Pack assembly must not transitively depend on concrete gameplay or behavior.',
  evidenceLevel: 'static dependency characterization; not the final architecture gate or bare-kernel runtime proof',
  reachableFiles: seen.size,
  forbiddenCount: forbidden.length,
  forbidden,
  enteringEdges: imports.filter(
    (edge) => !/\/server\/(gameplay|simulation)\//.test(edge.from) && /\/server\/(gameplay|simulation)\//.test(edge.to),
  ),
  unresolved,
  status: unresolved.length ? 'PROBE_ERROR' : forbidden.length ? 'RED' : 'GREEN',
};
process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
process.exitCode = unresolved.length ? 2 : forbidden.length ? 1 : 0;

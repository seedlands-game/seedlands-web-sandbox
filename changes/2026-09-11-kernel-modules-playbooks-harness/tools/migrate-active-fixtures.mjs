import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { dirname, posix, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import ts from 'typescript';
const root = resolve(import.meta.dirname, '../../..');
const list = (dir) =>
  existsSync(resolve(root, dir))
    ? readdirSync(resolve(root, dir), { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? list(`${dir}/${e.name}`) : [`${dir}/${e.name}`],
      )
    : [];
const copies = new Map([
  [
    'changes/2026-09-07-data-plane-adoption/e2e/workload-corpus.ts',
    'apps/web/tests/support/performance/workload-corpus.ts',
  ],
  [
    'changes/2026-09-07-data-plane-adoption/e2e/ab-statistics.ts',
    'apps/web/tests/support/performance/ab-statistics.ts',
  ],
  [
    'changes/2026-09-06-stable-sun-and-break-drop/e2e/sun-shadow-sampling.ts',
    'apps/web/tests/support/performance/sun-shadow-sampling.ts',
  ],
  [
    'changes/2026-09-05-voxel-rendering-pipeline-experiments/experiment-contract.ts',
    'apps/web/tests/support/performance/render-experiment-contract.ts',
  ],
  [
    'changes/2026-09-10-npc-composable-baseline/e2e/real-three-evidence.ts',
    'apps/agent-server/tests/support/real-three-evidence.ts',
  ],
  ['changes/2026-09-10-npc-composable-baseline/e2e/camp-pack.ts', 'apps/web/tests/fixtures/packs/camp-pack.ts'],
  [
    'changes/2026-09-04-world-mutation-transaction/performance-baseline.json',
    'harness/baselines/world-mutation/c18a890.json',
  ],
  ...list('changes/2026-09-10-npc-composable-baseline/fixtures').map((p) => [
    p,
    p.replace('changes/2026-09-10-npc-composable-baseline/fixtures', 'apps/web/tests/fixtures/npc'),
  ]),
]);
const moves = new Map(
  list('packages/stdlib/tests')
    .filter(
      (p) =>
        p.endsWith('.ts') &&
        (/apps\/(web|agent-server)/.test(readFileSync(resolve(root, p), 'utf8')) ||
          p.includes('/composition/') ||
          p.endsWith('/simd-kernel-equivalence.test.ts')),
    )
    .map((p) => [p, p.replace('packages/stdlib/tests/', 'apps/web/tests/integration/runtime/')]),
);
const map = new Map([...copies, ...moves]);
const all = [...list('packages/stdlib/tests'), ...list('apps/web/tests'), ...list('apps/agent-server/tests')].filter(
  (p) => /\.(ts|mts|mjs)$/.test(p),
);
const paths = new Set([...all, ...copies.keys(), ...list('packages/stdlib/src'), ...list('apps/web/src')]);
function relocated(p) {
  if (map.has(p)) return map.get(p);
  if (p.startsWith('packages/game-core/src/')) return p.replace('packages/game-core/src/', 'packages/stdlib/src/');
  if (p === 'changes/2026-09-10-npc-composable-baseline/fixtures') return 'apps/web/tests/fixtures/npc';
  return p;
}
for (const original of new Set([...all, ...copies.keys()])) {
  const target = relocated(original);
  let contents = readFileSync(resolve(root, original), 'utf8');
  if (/\.(ts|mts|mjs)$/.test(original)) {
    const source = ts.createSourceFile(original, contents, ts.ScriptTarget.Latest, true);
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
          const absolute = posix.normalize(posix.join(posix.dirname(original), name)).replace(/\/$/, '');
          const actual = [absolute, `${absolute}.ts`, `${absolute}.mjs`].find((p) => paths.has(p)) ?? absolute;
          let changed = relocated(actual);
          if (actual !== absolute) changed = changed.replace(/\.(ts|mjs)$/, '');
          name = posix.relative(posix.dirname(target), changed);
          if (!name.startsWith('.')) name = `./${name}`;
          if (literal.text.endsWith('/')) name += '/';
        } else
          name = name
            .replace('@seedlands/game-core/server/composition/host-api', '@seedlands/stdlib/host')
            .replace('@seedlands/game-core', '@seedlands/stdlib');
        if (name !== literal.text)
          edits.push({ start: literal.getStart(source) + 1, end: literal.getEnd() - 1, value: name });
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    for (const edit of edits.sort((a, b) => b.start - a.start))
      contents = contents.slice(0, edit.start) + edit.value + contents.slice(edit.end);
    contents = contents
      .replaceAll('changes/2026-09-07-data-plane-adoption/evidence/', 'apps/web/src/generated/wasm/')
      .replaceAll("'changes/2026-09-07-data-plane-adoption/evidence'", "'apps/web/src/generated/wasm'")
      .replaceAll('simd-build-manifest.json', 'rust-kernel-manifest.json')
      .replaceAll('kernels-${', 'rust-kernels-${')
      .replaceAll('/kernels-scalar.wasm', '/rust-kernels-scalar.wasm');
    if (target.endsWith('/camp-pack.ts'))
      contents = contents.replaceAll(
        'changes/2026-09-10-npc-composable-baseline/examples/',
        'apps/web/tests/fixtures/packs/',
      );
  }
  mkdirSync(dirname(resolve(root, target)), { recursive: true });
  if (moves.has(original)) renameSync(resolve(root, original), resolve(root, target));
  if (target !== original || contents !== readFileSync(resolve(root, target), 'utf8'))
    writeFileSync(resolve(root, target), contents);
}
const provenance = [...copies].map(([from, to]) => ({
  from,
  to,
  sourceSha256: createHash('sha256')
    .update(readFileSync(resolve(root, from)))
    .digest('hex'),
  targetSha256: createHash('sha256')
    .update(readFileSync(resolve(root, to)))
    .digest('hex'),
}));
writeFileSync(
  resolve(root, 'changes/2026-09-11-kernel-modules-playbooks-harness/active-fixtures-map.json'),
  JSON.stringify({ copies: provenance, moves: Object.fromEntries(moves) }, null, 2) + '\n',
);
console.log(
  `Copied ${copies.size} active fixtures/helpers and moved ${moves.size} cross-owner tests into Web integration.`,
);

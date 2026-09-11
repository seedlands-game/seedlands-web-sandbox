import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import ts from 'typescript';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const change = new URL('../', import.meta.url);
const baseSha = 'c18a890c7f97f76421e13565ec628d8c50a942da';
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
const read = (name) => JSON.parse(readFileSync(new URL(name, change), 'utf8'));
const originalMap = read('test-owner-map.json');
const mapping = Object.assign(
  {},
  originalMap,
  read('active-fixtures-map.json').moves,
  read('classic-integration-test-map.json'),
  read('web-runtime-test-map.json'),
  read('benchmark-owner-map.json'),
  {
    'packages/eslint-plugin/tests/pack-api-consumer.test.ts':
      'apps/web/tests/integration/architecture/pack-api-consumer.test.ts',
    'packages/eslint-plugin/tests/svelte-ui-boundary.test.ts':
      'apps/web/tests/integration/architecture/svelte-ui-boundary.test.ts',
  },
);
const basePaths = new Set(git('ls-tree', '-r', '--name-only', baseSha).trim().split('\n'));

function index(path, text) {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const tests = [];
  const assertions = [];
  function visit(node) {
    if (ts.isCallExpression(node)) {
      const expression = node.expression.getText(source);
      if (/^(it|test)(\.(each|skip|only|todo|fails|runIf|skipIf))?(\(|$)/.test(expression)) {
        const title = node.arguments[0];
        tests.push(title?.getText(source) ?? '');
      }
      if (
        /^expect(?:\(|\.)/.test(expression) &&
        !ts.isCallExpression(node.parent) &&
        !ts.isPropertyAccessExpression(node.parent)
      ) {
        assertions.push(node.getText(source));
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return {
    sha256: createHash('sha256').update(text).digest('hex'),
    tests,
    assertionCount: assertions.length,
    assertionDigest: createHash('sha256').update(JSON.stringify(assertions)).digest('hex'),
  };
}

const entries = [];
for (const old of Object.keys(originalMap)) {
  if (!/\.test\.[cm]?[jt]s$/.test(old) || !basePaths.has(old)) continue;
  let target = old;
  const seen = new Set();
  while (mapping[target]) {
    if (seen.has(target)) throw new Error(`Migration map cycle: ${target}`);
    seen.add(target);
    target = mapping[target];
  }
  const before = index(old, git('show', `${baseSha}:${old}`));
  const after = existsSync(resolve(root, target)) ? index(target, readFileSync(resolve(root, target), 'utf8')) : null;
  entries.push({
    source: old,
    target,
    before,
    after,
    reviewRequired: !after || after.tests.length < before.tests.length || after.assertionCount < before.assertionCount,
  });
}
writeFileSync(
  new URL('deterministic-test-migration-ledger.json', change),
  JSON.stringify(
    {
      schemaVersion: 1,
      baseSha,
      rule: 'AST direct-call inventory only; counts and preserved text do not prove fixture or semantic equivalence. Reductions require explicit review; new tests outside the original migration map are not counted.',
      entries,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  JSON.stringify({
    files: entries.length,
    review: entries
      .filter((entry) => entry.reviewRequired)
      .map(({ source, target, before, after }) => ({
        source,
        target,
        before: [before.tests.length, before.assertionCount],
        after: after ? [after.tests.length, after.assertionCount] : null,
      })),
  }),
);

const crypto = require('node:crypto');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const prettier = require('prettier');
const ts = require('typescript');
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

function readClassicSnapshot(path) {
  const text = fs.readFileSync(path, 'utf8');
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declaration = source.statements.find(
    (node) => ts.isTypeAliasDeclaration(node) && node.name.text === 'ClassicSnapshot',
  );
  if (!declaration) throw new Error(`Missing ClassicSnapshot in ${path}`);
  return ts.createPrinter().printNode(ts.EmitHint.Unspecified, declaration.type, source);
}

const priorPath =
  'changes/2026-09-23-classic-functional-completion/evidence/v2-arrival-during-aim-close-12-format-closure/prior-release/harness.ts';
const currentPath = 'apps/web/tests/e2e/classic-support/harness-snapshot.ts';
const priorType = readClassicSnapshot(priorPath);
const currentType = readClassicSnapshot(currentPath);
if (priorType !== currentType) throw new Error('ClassicSnapshot type AST differs');

const priorHarness = fs.readFileSync(priorPath, 'utf8');
const harness = fs.readFileSync('apps/web/tests/e2e/classic-support/harness.ts', 'utf8');
if (!harness.includes("import type { ClassicSnapshot } from './harness-snapshot';"))
  throw new Error('ClassicSnapshot type import is missing');
if (!harness.includes("export type { ClassicSnapshot } from './harness-snapshot';"))
  throw new Error('ClassicSnapshot type re-export is missing');
if (harness.includes("import { ClassicSnapshot } from './harness-snapshot';"))
  throw new Error('ClassicSnapshot was added as a runtime import');
async function normalizedRuntime(source) {
  const emitted = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, removeComments: true },
  }).outputText;
  return prettier.format(emitted, { parser: 'babel' });
}

async function main() {
  const priorRuntime = await normalizedRuntime(priorHarness);
  const currentRuntime = await normalizedRuntime(harness);
  if (priorRuntime !== currentRuntime) throw new Error('harness.ts normalized emitted runtime differs');
  const baseline = fs.readFileSync(
    '/private/tmp/seedlands-v2-acceptance-908d0d82/apps/web/tests/e2e/classic-support/harness.ts',
    'utf8',
  );
  const diff = execFileSync('git', ['diff', '-U0', '--', 'apps/web/tests/e2e/classic-support/harness.ts'], {
    encoding: 'utf8',
  });
  process.stdout.write(
    `${JSON.stringify(
      {
        status: 'PASS',
        priorTypeAstSha256: hash(priorType),
        currentTypeAstSha256: hash(currentType),
        typeAstByteEqual: true,
        priorNormalizedRuntimeSha256: hash(priorRuntime),
        currentNormalizedRuntimeSha256: hash(currentRuntime),
        normalizedRuntimeByteEqual: true,
        baselineInlinePrettierIgnoreCount: baseline.match(/prettier-ignore/g)?.length ?? 0,
        priorReleaseInlinePrettierIgnoreCount: priorHarness.match(/prettier-ignore/g)?.length ?? 0,
        currentInlinePrettierIgnoreCount: harness.match(/prettier-ignore/g)?.length ?? 0,
        addedInlinePrettierIgnoreCount: diff.match(/^\+.*prettier-ignore$/gm)?.length ?? 0,
        runtimeImportAdded: false,
        typeImportAndReExport: true,
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exitCode = 1;
});

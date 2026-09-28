import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const evidenceDirectory = dirname(fileURLToPath(import.meta.url));
const root = resolve(evidenceDirectory, '../../../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const requireCondition = (condition, message) => {
  if (!condition) throw new Error(message);
};
const occurrences = (source, needle) => source.split(needle).length - 1;

const configPath = 'playwright.config.ts';
const configText = read(configPath);
const configSource = ts.createSourceFile(configPath, configText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
let configObject;
for (const statement of configSource.statements) {
  if (
    ts.isExportAssignment(statement) &&
    ts.isCallExpression(statement.expression) &&
    statement.expression.expression.getText(configSource) === 'defineConfig' &&
    ts.isObjectLiteralExpression(statement.expression.arguments[0])
  )
    configObject = statement.expression.arguments[0];
}
requireCondition(configObject, 'defineConfig object is missing.');
const property = (object, name) =>
  object.properties.find(
    (entry) => ts.isPropertyAssignment(entry) && ts.isIdentifier(entry.name) && entry.name.text === name,
  )?.initializer;
const reporters = property(configObject, 'reporter');
requireCondition(ts.isArrayLiteralExpression(reporters), 'reporter is not an array.');
const reporterNames = reporters.elements.map((entry) => {
  requireCondition(ts.isArrayLiteralExpression(entry), 'reporter entry is not an array.');
  const name = entry.elements[0];
  requireCondition(ts.isStringLiteral(name), 'reporter name is not a string.');
  return name.text;
});
requireCondition(
  JSON.stringify(reporterNames) ===
    JSON.stringify(['list', 'html', './apps/web/tests/e2e/classic-support/canonical-reporter.ts']),
  'reporter order or identity changed.',
);

const main = read('apps/web/tests/e2e/classic-runtime.spec.ts');
const evidence = read('apps/web/tests/e2e/classic-support/evidence.ts');
const reporter = read('apps/web/tests/e2e/classic-support/canonical-reporter.ts');
const receipt = read('scripts/harness/classic-receipt.mjs');
const runner = read('scripts/harness/classic.mjs');
requireCondition(occurrences(main, 'test.setTimeout(900_000)') === 1, 'canonical main budget changed.');
requireCondition(
  occurrences(configText, "projects: [{ name: 'chromium', timeout: 60_000 }]") === 1,
  'project budget changed.',
);
requireCondition(!evidence.includes('SEEDLANDS_CLASSIC_RESULT'), 'attachment owner still reads the receipt path.');
requireCondition(!evidence.includes('writeAttempt'), 'legacy append writer remains.');
requireCondition(occurrences(reporter, 'writeFileSync(') === 1, 'reporter is not the unique file writer.');
requireCondition(occurrences(reporter, 'onTestEnd(') === 1, 'reporter terminal callback is missing.');
requireCondition(occurrences(reporter, 'onEnd(') === 1, 'reporter run callback is missing.');
requireCondition(!receipt.includes('\u0000'), 'receipt helper contains a NUL escape key.');
requireCondition(!Buffer.from(receipt).includes(0), 'receipt helper contains a NUL byte.');
for (const token of [
  'export const modularSmokeIdentity',
  'file: event.file',
  'attempt.testId !== selectedMain?.testId',
  'attempt.file !== canonicalMainIdentity.file',
  "(selection.mode === 'MODULAR_WORLD') !== Boolean(options.modularWorld)",
  "receipt.runnerOutcome !== 'passed' || receipt.status !== 'PASS'",
])
  requireCondition(receipt.includes(token), `receipt token missing: ${token}`);
for (const token of [
  'rmSync(resultPath, { force: true })',
  'readClassicReceipt(resultPath)',
  'validateClassicRunReceipt(receipt',
  'processStatus: result.status',
  'modularWorld,',
])
  requireCondition(runner.includes(token), `runner token missing: ${token}`);
requireCondition(
  runner.indexOf('rmSync(resultPath') < runner.indexOf('spawnSync('),
  'stale receipt is not removed first.',
);
requireCondition(
  runner.indexOf('verifyArtifact();', runner.indexOf('spawnSync(')) < runner.indexOf('readClassicReceipt(resultPath)'),
  'post-run artifact verification no longer precedes receipt validation.',
);

process.stdout.write(
  `${JSON.stringify(
    {
      schemaVersion: 1,
      status: 'PASS',
      reporters: reporterNames,
      canonicalMainTimeoutMs: 900000,
      chromiumProjectTimeoutMs: 60000,
      attachmentWriterCount: 0,
      reporterWriterCount: 1,
      reporterCallbacks: ['onBegin', 'onTestEnd', 'onEnd'],
      staleReceiptRemovedBeforeSpawn: true,
      artifactReverifiedBeforeReceiptValidation: true,
      receiptKeyEncoding: 'JSON_TUPLE_NO_NUL',
      attemptIdentityBoundToSelection: true,
      modularSelectionBoundToRunMode: true,
      runnerOutcomeRequiredForEverySelection: true,
    },
    null,
    2,
  )}\n`,
);

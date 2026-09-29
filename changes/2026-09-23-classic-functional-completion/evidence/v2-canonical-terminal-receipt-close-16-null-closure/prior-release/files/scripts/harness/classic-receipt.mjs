import { readFileSync } from 'node:fs';

export const canonicalMainIdentity = Object.freeze({
  file: 'apps/web/tests/e2e/classic-runtime.spec.ts',
  title: 'Classic 生产旅程以真实输入完成 C0-C5，并复用同一运行时性能场景',
  project: 'chromium',
});
export const modularSmokeIdentity = Object.freeze({
  file: canonicalMainIdentity.file,
  title: '非 Classic Playbook 从锁定 production artifact 启动并消费自定义 worldgen/voxel/presentation',
  project: canonicalMainIdentity.project,
});

const terminalStatuses = new Set(['passed', 'failed', 'timedOut', 'skipped', 'interrupted']);
const runnerStatuses = new Set(['running', 'passed', 'failed', 'timedout', 'interrupted']);

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const stableValue = (value) => JSON.stringify(value);
const attemptKey = ({ test, project, retry, attempt }) => JSON.stringify([project, test, retry ?? attempt]);

function requireRecord(value, label) {
  if (!isRecord(value)) throw new Error(`${label} is invalid.`);
  return value;
}

function requireString(value, label) {
  if (typeof value !== 'string' || !value) throw new Error(`${label} is invalid.`);
  return value;
}

function requireInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} is invalid.`);
  return value;
}

function distinctPayloads(attachments, name) {
  const values = attachments.filter((attachment) => attachment.name === name).map(({ payload }) => payload);
  const distinct = new Map(values.map((value) => [stableValue(value), value]));
  return [...distinct.values()];
}

function localEvidenceError(payload, event, runId, sourceSha) {
  if (!isRecord(payload)) return 'attachment is not a JSON object';
  if (payload.test !== event.test || payload.project !== event.project || payload.attempt !== event.retry)
    return 'attachment test identity does not match the terminal result';
  if (payload.runId !== runId) return 'attachment runId does not match the Harness run';
  const attachmentSource = payload.artifact?.identity?.sourceSha ?? payload.sourceSha;
  if (attachmentSource !== sourceSha) return 'attachment sourceSha does not match the Harness source';
  if (payload.status !== 'PASS' && payload.status !== 'FAIL') return 'attachment status is invalid';
  return null;
}

function receiptStatus(receipt) {
  if (receipt.runnerOutcome !== 'passed' || receipt.conflicts.length) return 'FAIL';
  if (receipt.selection.mode === 'CANONICAL_MAIN')
    return receipt.attempts.length === 1 && receipt.attempts[0]?.status === 'PASS' ? 'PASS' : 'FAIL';
  return receipt.selection.mode === 'NON_MAIN' || receipt.selection.mode === 'MODULAR_WORLD'
    ? receipt.attempts.length === 0
      ? 'PASS'
      : 'FAIL'
    : 'FAIL';
}

export function isCanonicalMainTest(test) {
  return (
    test.file === canonicalMainIdentity.file &&
    test.test === canonicalMainIdentity.title &&
    test.project === canonicalMainIdentity.project
  );
}

function isModularSmokeTest(test) {
  return (
    test.file === modularSmokeIdentity.file &&
    test.test === modularSmokeIdentity.title &&
    test.project === modularSmokeIdentity.project
  );
}

export function createCanonicalSelection(selectedTests, { modularWorld = false } = {}) {
  const normalized = selectedTests.map((test) => ({
    testId: requireString(test.testId, 'selected test id'),
    file: requireString(test.file, 'selected test file'),
    test: requireString(test.test, 'selected test title'),
    project: requireString(test.project, 'selected test project'),
  }));
  const canonicalMainMatches = normalized.filter(isCanonicalMainTest).length;
  const modularSmokeMatches = normalized.filter(isModularSmokeTest).length;
  const mode = modularWorld
    ? modularSmokeMatches === 1
      ? 'MODULAR_WORLD'
      : 'AMBIGUOUS'
    : canonicalMainMatches === 1
      ? 'CANONICAL_MAIN'
      : canonicalMainMatches === 0
        ? 'NON_MAIN'
        : 'AMBIGUOUS';
  return {
    mode,
    canonicalMainSelected: mode === 'CANONICAL_MAIN',
    canonicalMainMatches,
    modularSmokeMatches,
    selectedTests: normalized,
  };
}

export function createClassicReceipt({ runId, sourceSha, selection }) {
  return {
    schemaVersion: 1,
    status: 'FAIL',
    runId: requireString(runId, 'receipt runId'),
    sourceSha: requireString(sourceSha, 'receipt sourceSha'),
    selection: requireRecord(selection, 'receipt selection'),
    runnerOutcome: 'running',
    attempts: [],
    conflicts: [],
  };
}

export function recordCanonicalTestEnd(receipt, event) {
  if (!isCanonicalMainTest(event) || receipt.selection.mode !== 'CANONICAL_MAIN') return receipt;
  if (!terminalStatuses.has(event.resultStatus)) throw new Error('Canonical terminal result status is invalid.');
  const retry = requireInteger(event.retry, 'canonical retry');
  const detailed = distinctPayloads(event.attachments, 'classic-runtime-evidence.json');
  const failures = distinctPayloads(event.attachments, 'classic-runtime-failure.json');
  const receiptErrors = event.attachments.flatMap((attachment) =>
    attachment.error ? [`${attachment.name} ${attachment.error}`] : [],
  );
  if (detailed.length > 1) receiptErrors.push('conflicting detailed evidence attachments');
  if (failures.length > 1) receiptErrors.push('conflicting failure evidence attachments');
  const assertionEvidence = detailed[0] ?? null;
  const failureEvidence = failures[0] ?? null;
  if (assertionEvidence) {
    const error = localEvidenceError(assertionEvidence, event, receipt.runId, receipt.sourceSha);
    if (error) receiptErrors.push(`detailed ${error}`);
  }
  if (failureEvidence) {
    const error = localEvidenceError(failureEvidence, event, receipt.runId, receipt.sourceSha);
    if (error) receiptErrors.push(`failure ${error}`);
  }
  const assertionEvidenceStatus = isRecord(assertionEvidence) ? assertionEvidence.status : 'MISSING';
  const passed =
    event.resultStatus === 'passed' &&
    event.resultErrors.length === 0 &&
    assertionEvidenceStatus === 'PASS' &&
    failureEvidence === null &&
    receiptErrors.length === 0;
  const inherited = isRecord(assertionEvidence) ? assertionEvidence : {};
  const attempt = {
    ...inherited,
    schemaVersion: 1,
    status: passed ? 'PASS' : 'FAIL',
    attempt: retry,
    testId: event.testId,
    file: event.file,
    test: event.test,
    project: event.project,
    runId: receipt.runId,
    sourceSha: receipt.sourceSha,
    testOutcome: event.resultStatus,
    assertionEvidenceStatus,
    resultErrors: [...event.resultErrors],
    failureEvidence,
    receiptErrors,
  };
  const key = attemptKey(attempt);
  const existing = receipt.attempts.find((candidate) => attemptKey(candidate) === key);
  if (existing) {
    if (stableValue(existing) === stableValue(attempt)) return receipt;
    return {
      ...receipt,
      status: 'FAIL',
      conflicts: [...receipt.conflicts, { key, reason: 'conflicting terminal event for the same attempt' }],
    };
  }
  return {
    ...receipt,
    attempts: [...receipt.attempts, attempt].sort((left, right) => left.attempt - right.attempt),
  };
}

export function finalizeClassicReceipt(receipt, runnerOutcome) {
  if (!runnerStatuses.has(runnerOutcome) || runnerOutcome === 'running')
    throw new Error('Classic runner outcome is invalid.');
  const finalized = { ...receipt, runnerOutcome };
  return { ...finalized, status: receiptStatus(finalized) };
}

export function parseClassicReceiptText(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Classic terminal receipt is malformed.');
  }
}

export function readClassicReceipt(path) {
  try {
    return parseClassicReceiptText(readFileSync(path, 'utf8'));
  } catch (error) {
    if (error instanceof Error && error.message === 'Classic terminal receipt is malformed.') throw error;
    throw new Error('Classic terminal receipt is missing or unreadable.', { cause: error });
  }
}

export function validateClassicRunReceipt(unknownReceipt, options) {
  if (options.processStatus !== 0) throw new Error('Classic Playwright process did not exit successfully.');
  const receipt = requireRecord(unknownReceipt, 'Classic terminal receipt');
  if (receipt.schemaVersion !== 1) throw new Error('Classic terminal receipt schema is invalid.');
  if (receipt.runId !== options.runId) throw new Error('Classic terminal receipt runId is stale.');
  if (receipt.sourceSha !== options.sourceSha) throw new Error('Classic terminal receipt sourceSha is stale.');
  if (!Array.isArray(receipt.attempts) || !Array.isArray(receipt.conflicts) || receipt.conflicts.length)
    throw new Error('Classic terminal receipt attempts are ambiguous.');
  const selection = requireRecord(receipt.selection, 'Classic terminal receipt selection');
  if (!Array.isArray(selection.selectedTests)) throw new Error('Classic terminal receipt selection tests are invalid.');
  const derivedSelection = createCanonicalSelection(selection.selectedTests, {
    modularWorld: selection.mode === 'MODULAR_WORLD',
  });
  if (
    derivedSelection.mode !== selection.mode ||
    derivedSelection.canonicalMainSelected !== selection.canonicalMainSelected ||
    derivedSelection.canonicalMainMatches !== selection.canonicalMainMatches ||
    derivedSelection.modularSmokeMatches !== selection.modularSmokeMatches
  )
    throw new Error('Classic terminal receipt selection identity is invalid.');
  if ((selection.mode === 'MODULAR_WORLD') !== Boolean(options.modularWorld))
    throw new Error('Classic terminal receipt selection mode mismatches the Harness run mode.');
  if (selection.mode === 'AMBIGUOUS') throw new Error('Classic canonical main selection is ambiguous.');
  if (options.requireCanonicalMain && selection.mode !== 'CANONICAL_MAIN')
    throw new Error('Classic canonical main was not selected.');
  if (selection.mode === 'CANONICAL_MAIN' && receipt.attempts.length !== 1)
    throw new Error('Classic run requires exactly one canonical attempt.');
  if (receipt.runnerOutcome !== 'passed' || receipt.status !== 'PASS')
    throw new Error('Classic terminal receipt did not finish with a passing runner outcome.');
  if (selection.mode !== 'CANONICAL_MAIN') {
    if (selection.mode !== 'NON_MAIN' && selection.mode !== 'MODULAR_WORLD')
      throw new Error('Classic terminal receipt selection mode is invalid.');
    if (receipt.attempts.length) throw new Error('Non-main Classic selection contains canonical attempts.');
    if (options.benchmark) throw new Error('Classic benchmark requires the canonical main.');
    return null;
  }
  if (selection.canonicalMainMatches !== 1 || selection.canonicalMainSelected !== true)
    throw new Error('Classic canonical main selection identity is invalid.');
  const attempt = requireRecord(receipt.attempts[0], 'Classic canonical attempt');
  const selectedMain = selection.selectedTests.find(isCanonicalMainTest);
  if (
    attempt.attempt !== 0 ||
    attempt.testId !== selectedMain?.testId ||
    attempt.file !== canonicalMainIdentity.file ||
    attempt.test !== canonicalMainIdentity.title ||
    attempt.project !== canonicalMainIdentity.project ||
    attempt.testOutcome !== 'passed' ||
    attempt.assertionEvidenceStatus !== 'PASS' ||
    attempt.status !== 'PASS'
  )
    throw new Error('Classic canonical attempt did not terminate successfully.');
  if (attempt.runId !== options.runId || attempt.sourceSha !== options.sourceSha)
    throw new Error('Classic canonical attempt identity is stale.');
  if (options.benchmark && attempt.benchmark?.measurement?.status !== 'MEASURED')
    throw new Error('Classic benchmark did not produce a measured record.');
  return attempt;
}

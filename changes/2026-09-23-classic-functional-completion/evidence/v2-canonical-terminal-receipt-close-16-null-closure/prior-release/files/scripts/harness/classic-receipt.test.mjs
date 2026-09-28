import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  canonicalMainIdentity,
  createClassicReceipt,
  finalizeClassicReceipt,
  modularSmokeIdentity,
  parseClassicReceiptText,
  readClassicReceipt,
  recordCanonicalTestEnd,
  validateClassicRunReceipt,
} from './classic-receipt.mjs';

const runId = 'terminal-receipt-test';
const sourceSha = 'a'.repeat(40);
const measurement = { status: 'MEASURED', runId, owner: 'web-runtime', scenario: 'classic' };
const detailed = (status = 'PASS') => ({
  schemaVersion: 1,
  status,
  attempt: 0,
  test: canonicalMainIdentity.title,
  project: canonicalMainIdentity.project,
  runId,
  artifact: { identity: { sourceSha } },
  benchmark: { measurement },
  stages: { C0: { status: 'PASS' }, C5: { status: 'PASS' } },
  restoreEvidence: { after: { v2Equipment: { phase: 'restored' } } },
});
const failure = () => ({
  schemaVersion: 1,
  status: 'FAIL',
  attempt: 0,
  test: canonicalMainIdentity.title,
  project: canonicalMainIdentity.project,
  runId,
  sourceSha,
  errors: ['Test timeout of 720000ms exceeded.'],
});
const selection = (selected = true) => ({
  mode: selected ? 'CANONICAL_MAIN' : 'NON_MAIN',
  canonicalMainSelected: selected,
  canonicalMainMatches: selected ? 1 : 0,
  modularSmokeMatches: 0,
  selectedTests: selected
    ? [
        {
          testId: 'canonical-id',
          file: canonicalMainIdentity.file,
          test: canonicalMainIdentity.title,
          project: canonicalMainIdentity.project,
        },
      ]
    : [],
});
const event = ({ status = 'passed', retry = 0, attachments = [] } = {}) => ({
  testId: 'canonical-id',
  file: canonicalMainIdentity.file,
  test: canonicalMainIdentity.title,
  project: canonicalMainIdentity.project,
  retry,
  resultStatus: status,
  resultErrors: status === 'passed' ? [] : [`result:${status}`],
  attachments,
});
const attachment = (name, payload) => ({ name, payload });

test('Browser23 failure and local PASS become one terminal FAIL in either attachment order', () => {
  for (const attachments of [
    [attachment('classic-runtime-failure.json', failure()), attachment('classic-runtime-evidence.json', detailed())],
    [attachment('classic-runtime-evidence.json', detailed()), attachment('classic-runtime-failure.json', failure())],
  ]) {
    const receipt = recordCanonicalTestEnd(
      createClassicReceipt({ runId, sourceSha, selection: selection() }),
      event({ status: 'timedOut', attachments }),
    );
    assert.equal(receipt.attempts.length, 1);
    assert.equal(receipt.attempts[0].status, 'FAIL');
    assert.equal(receipt.attempts[0].testOutcome, 'timedOut');
    assert.equal(receipt.attempts[0].assertionEvidenceStatus, 'PASS');
    assert.deepEqual(receipt.attempts[0].stages.C5, { status: 'PASS' });
    assert.deepEqual(receipt.attempts[0].restoreEvidence.after.v2Equipment, { phase: 'restored' });
    assert.deepEqual(receipt.attempts[0].failureEvidence.errors, ['Test timeout of 720000ms exceeded.']);
  }
});

test('test outcome and local failure both fail closed while complete PASS preserves measurement', () => {
  const failedAfterPass = recordCanonicalTestEnd(
    createClassicReceipt({ runId, sourceSha, selection: selection() }),
    event({ status: 'failed', attachments: [attachment('classic-runtime-evidence.json', detailed())] }),
  );
  assert.equal(failedAfterPass.attempts[0].status, 'FAIL');

  const localFailure = recordCanonicalTestEnd(
    createClassicReceipt({ runId, sourceSha, selection: selection() }),
    event({ status: 'passed', attachments: [attachment('classic-runtime-failure.json', failure())] }),
  );
  assert.equal(localFailure.attempts[0].status, 'FAIL');

  const passed = recordCanonicalTestEnd(
    createClassicReceipt({ runId, sourceSha, selection: selection() }),
    event({ status: 'passed', attachments: [attachment('classic-runtime-evidence.json', detailed())] }),
  );
  assert.equal(passed.attempts[0].status, 'PASS');
  assert.deepEqual(passed.attempts[0].benchmark.measurement, measurement);

  for (const staleDetailed of [
    { ...detailed(), runId: 'stale' },
    { ...detailed(), artifact: { identity: { sourceSha: 'c'.repeat(40) } } },
  ]) {
    const stale = recordCanonicalTestEnd(
      createClassicReceipt({ runId, sourceSha, selection: selection() }),
      event({ status: 'passed', attachments: [attachment('classic-runtime-evidence.json', staleDetailed)] }),
    );
    assert.equal(stale.attempts[0].status, 'FAIL');
    assert.equal(stale.attempts[0].receiptErrors.length, 1);
  }
});

test('non-main tests do not pollute receipt and duplicate keys are idempotent or conflicting', () => {
  const initial = createClassicReceipt({ runId, sourceSha, selection: selection() });
  const visual = recordCanonicalTestEnd(initial, {
    ...event({ status: 'passed', attachments: [attachment('classic-runtime-evidence.json', detailed())] }),
    testId: 'visual-id',
    test: 'Classic 视觉 v3 生产素材、连续帧与单击破坏回归',
  });
  assert.equal(visual.attempts.length, 0);

  const first = recordCanonicalTestEnd(
    initial,
    event({ attachments: [attachment('classic-runtime-evidence.json', detailed())] }),
  );
  const idempotent = recordCanonicalTestEnd(
    first,
    event({ attachments: [attachment('classic-runtime-evidence.json', detailed())] }),
  );
  assert.deepEqual(idempotent, first);
  const conflict = recordCanonicalTestEnd(
    first,
    event({ status: 'failed', attachments: [attachment('classic-runtime-evidence.json', detailed())] }),
  );
  assert.equal(conflict.status, 'FAIL');
  assert.equal(conflict.conflicts.length, 1);
});

test('different retries remain visible and the unique-attempt gate rejects them', () => {
  const first = recordCanonicalTestEnd(
    createClassicReceipt({ runId, sourceSha, selection: selection() }),
    event({ attachments: [attachment('classic-runtime-evidence.json', detailed())] }),
  );
  const retried = recordCanonicalTestEnd(
    first,
    event({ retry: 1, attachments: [attachment('classic-runtime-evidence.json', { ...detailed(), attempt: 1 })] }),
  );
  assert.deepEqual(
    retried.attempts.map(({ attempt }) => attempt),
    [0, 1],
  );
  assert.throws(
    () =>
      validateClassicRunReceipt(finalizeClassicReceipt(retried, 'passed'), {
        runId,
        sourceSha,
        processStatus: 0,
        requireCanonicalMain: true,
        benchmark: false,
      }),
    /exactly one/,
  );
});

test('runner validation rejects process failure and stale or missing full receipts', () => {
  const complete = finalizeClassicReceipt(
    recordCanonicalTestEnd(
      createClassicReceipt({ runId, sourceSha, selection: selection() }),
      event({ attachments: [attachment('classic-runtime-evidence.json', detailed())] }),
    ),
    'passed',
  );
  assert.throws(
    () =>
      validateClassicRunReceipt(complete, {
        runId,
        sourceSha,
        processStatus: 1,
        requireCanonicalMain: true,
        benchmark: false,
      }),
    /process/,
  );
  assert.throws(
    () =>
      validateClassicRunReceipt(
        { ...complete, runId: 'stale' },
        {
          runId,
          sourceSha,
          processStatus: 0,
          requireCanonicalMain: true,
          benchmark: false,
        },
      ),
    /runId/,
  );
  assert.throws(
    () =>
      validateClassicRunReceipt(
        { ...complete, sourceSha: 'c'.repeat(40) },
        {
          runId,
          sourceSha,
          processStatus: 0,
          requireCanonicalMain: true,
          benchmark: false,
        },
      ),
    /sourceSha/,
  );
  assert.throws(
    () =>
      validateClassicRunReceipt(
        {
          ...complete,
          selection: {
            ...complete.selection,
            selectedTests: [{ ...complete.selection.selectedTests[0], file: 'apps/web/tests/e2e/other.spec.ts' }],
          },
        },
        {
          runId,
          sourceSha,
          processStatus: 0,
          requireCanonicalMain: true,
          benchmark: false,
        },
      ),
    /selection identity/,
  );
  for (const staleAttempt of [
    { ...complete.attempts[0], testId: 'stale-id' },
    { ...complete.attempts[0], file: 'apps/web/tests/e2e/other.spec.ts' },
  ]) {
    assert.throws(
      () =>
        validateClassicRunReceipt(
          { ...complete, attempts: [staleAttempt] },
          {
            runId,
            sourceSha,
            processStatus: 0,
            requireCanonicalMain: true,
            benchmark: false,
          },
        ),
      /attempt did not terminate successfully/,
    );
  }
  assert.throws(
    () =>
      validateClassicRunReceipt(
        finalizeClassicReceipt(createClassicReceipt({ runId, sourceSha, selection: selection(false) }), 'passed'),
        { runId, sourceSha, processStatus: 0, requireCanonicalMain: true, benchmark: false },
      ),
    /selected/,
  );
  assert.throws(() => parseClassicReceiptText('{not json'), /malformed/);
  assert.throws(
    () =>
      validateClassicRunReceipt(
        { ...complete, conflicts: [{ key: 'duplicate' }] },
        {
          runId,
          sourceSha,
          processStatus: 0,
          requireCanonicalMain: true,
          benchmark: false,
        },
      ),
    /ambiguous/,
  );
});

test('missing receipt files and ambiguous main selections fail closed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'seedlands-missing-receipt-'));
  try {
    assert.throws(() => readClassicReceipt(join(directory, 'missing.json')), /missing or unreadable/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  const duplicateMain = {
    testId: 'canonical-id-2',
    file: canonicalMainIdentity.file,
    test: canonicalMainIdentity.title,
    project: canonicalMainIdentity.project,
  };
  const ambiguous = createClassicReceipt({
    runId,
    sourceSha,
    selection: {
      mode: 'AMBIGUOUS',
      canonicalMainSelected: false,
      canonicalMainMatches: 2,
      modularSmokeMatches: 0,
      selectedTests: [duplicateMain, { ...duplicateMain, testId: 'canonical-id-3' }],
    },
  });
  assert.throws(
    () =>
      validateClassicRunReceipt(finalizeClassicReceipt(ambiguous, 'passed'), {
        runId,
        sourceSha,
        processStatus: 0,
        requireCanonicalMain: true,
        benchmark: false,
      }),
    /ambiguous/,
  );
});

test('benchmark requires MEASURED while non-main correctness and modular selections remain valid', () => {
  const complete = finalizeClassicReceipt(
    recordCanonicalTestEnd(
      createClassicReceipt({ runId, sourceSha, selection: selection() }),
      event({ attachments: [attachment('classic-runtime-evidence.json', detailed())] }),
    ),
    'passed',
  );
  assert.equal(
    validateClassicRunReceipt(complete, {
      runId,
      sourceSha,
      processStatus: 0,
      requireCanonicalMain: true,
      benchmark: true,
    }).benchmark.measurement.status,
    'MEASURED',
  );
  const notSelected = finalizeClassicReceipt(
    createClassicReceipt({ runId, sourceSha, selection: selection(false) }),
    'passed',
  );
  assert.equal(
    validateClassicRunReceipt(notSelected, {
      runId,
      sourceSha,
      processStatus: 0,
      requireCanonicalMain: false,
      benchmark: false,
    }),
    null,
  );
  assert.throws(
    () =>
      validateClassicRunReceipt(
        { ...notSelected, runnerOutcome: 'failed', status: 'FAIL' },
        {
          runId,
          sourceSha,
          processStatus: 0,
          requireCanonicalMain: false,
          benchmark: false,
        },
      ),
    /runner outcome/,
  );
  const modularSelection = {
    mode: 'MODULAR_WORLD',
    canonicalMainSelected: false,
    canonicalMainMatches: 1,
    modularSmokeMatches: 1,
    selectedTests: [
      selection().selectedTests[0],
      {
        testId: 'modular-id',
        file: modularSmokeIdentity.file,
        test: modularSmokeIdentity.title,
        project: modularSmokeIdentity.project,
      },
    ],
  };
  assert.equal(
    validateClassicRunReceipt(
      finalizeClassicReceipt(createClassicReceipt({ runId, sourceSha, selection: modularSelection }), 'passed'),
      {
        runId,
        sourceSha,
        processStatus: 0,
        requireCanonicalMain: false,
        benchmark: false,
        modularWorld: true,
      },
    ),
    null,
  );
  assert.throws(
    () =>
      validateClassicRunReceipt(
        finalizeClassicReceipt(
          createClassicReceipt({
            runId,
            sourceSha,
            selection: { ...modularSelection, modularSmokeMatches: 1, selectedTests: selection().selectedTests },
          }),
          'passed',
        ),
        { runId, sourceSha, processStatus: 0, requireCanonicalMain: false, benchmark: false },
      ),
    /selection identity/,
  );
  assert.throws(
    () =>
      validateClassicRunReceipt(
        finalizeClassicReceipt(createClassicReceipt({ runId, sourceSha, selection: modularSelection }), 'passed'),
        { runId, sourceSha, processStatus: 0, requireCanonicalMain: false, benchmark: false },
      ),
    /run mode/,
  );
  const diagnostic = recordCanonicalTestEnd(
    createClassicReceipt({ runId, sourceSha, selection: selection() }),
    event({
      attachments: [
        attachment('classic-runtime-evidence.json', {
          ...detailed(),
          benchmark: { measurement: { ...measurement, status: 'DIAGNOSTIC' } },
        }),
      ],
    }),
  );
  assert.throws(
    () =>
      validateClassicRunReceipt(finalizeClassicReceipt(diagnostic, 'passed'), {
        runId,
        sourceSha,
        processStatus: 0,
        requireCanonicalMain: true,
        benchmark: true,
      }),
    /measured/,
  );
});

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { runReservedCommand } from '../../../../../scripts/benchmark-window.mjs';

it('marks only the reserved child as a measurement and releases its machine lock', () => {
  const directory = mkdtempSync(join(tmpdir(), 'seedlands-measurement-window-'));
  try {
    const lock = join(directory, 'lock');
    const result = join(directory, 'result.json');
    const measurementPath = join(directory, 'measurement.json');
    const evidence = join(directory, 'window.json');
    execFileSync(
      process.execPath,
      [
        resolve('scripts/benchmark-window.mjs'),
        '--lock-dir',
        lock,
        '--',
        process.execPath,
        '--input-type=module',
        '-e',
        `import {existsSync,writeFileSync} from 'node:fs';
const sampleStartedAt=new Date().toISOString();
const measurement={status:'MEASURED',runId:'fixture-run',owner:'stdlib-world',scenario:'fixture',windowId:process.env.SEEDLANDS_PERFORMANCE_WINDOW_ID,evidencePath:process.env.SEEDLANDS_PERFORMANCE_WINDOW_EVIDENCE,sampleStartedAt,sampleCompletedAt:new Date().toISOString(),sourceSha:'a'.repeat(40),sourceDigest:'b'.repeat(64),lockDigest:'c'.repeat(64),bundleDigest:'d'.repeat(64)};
writeFileSync(process.argv[3],JSON.stringify(measurement));
writeFileSync(process.env.SEEDLANDS_PERFORMANCE_MEASUREMENT_DECLARATION,JSON.stringify({schemaVersion:1,windowId:measurement.windowId,evidencePath:measurement.evidencePath,measurementPath:process.argv[3],format:'local',runId:measurement.runId,owner:measurement.owner,scenario:measurement.scenario}));
writeFileSync(process.argv[1],JSON.stringify({reserved:process.env.SEEDLANDS_PERFORMANCE_WINDOW_RESERVED,windowId:measurement.windowId,evidencePath:measurement.evidencePath,declarationPath:process.env.SEEDLANDS_PERFORMANCE_MEASUREMENT_DECLARATION,locked:existsSync(process.argv[2])}));`,
        result,
        join(lock, 'owner.json'),
        measurementPath,
      ],
      {
        env: {
          ...process.env,
          SEEDLANDS_PERFORMANCE_WINDOW_RESERVED: '0',
          SEEDLANDS_RESERVATION_EVIDENCE: evidence,
        },
      },
    );
    const child = JSON.parse(readFileSync(result, 'utf8')) as Record<string, unknown>;
    expect(child).toMatchObject({
      reserved: '1',
      evidencePath: evidence,
      locked: true,
    });
    expect(child.windowId).toMatch(/^[a-f0-9-]+$/);
    expect(child.declarationPath).toBe(`${evidence}.measurement.json`);
    expect(JSON.parse(readFileSync(evidence, 'utf8'))).toMatchObject({
      kind: 'seedlands-performance-window',
      status: 'PASS',
      windowId: child.windowId,
      exitCode: 0,
      measurement: {
        status: 'RECORDED',
        path: measurementPath,
        format: 'local',
        runId: 'fixture-run',
        owner: 'stdlib-world',
        scenario: 'fixture',
        sourceSha: 'a'.repeat(40),
        artifactDigest: 'd'.repeat(64),
      },
    });
    expect(existsSync(lock)).toBe(false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it('writes a failed window receipt when the reserved child fails', () => {
  const directory = mkdtempSync(join(tmpdir(), 'seedlands-measurement-window-failure-'));
  try {
    const evidence = join(directory, 'window.json');
    const result = spawnSync(
      process.execPath,
      [
        resolve('scripts/benchmark-window.mjs'),
        '--lock-dir',
        join(directory, 'lock'),
        '--',
        process.execPath,
        '-e',
        'process.exit(7)',
      ],
      { env: { ...process.env, SEEDLANDS_RESERVATION_EVIDENCE: evidence } },
    );
    expect(result.status).toBe(7);
    expect(JSON.parse(readFileSync(evidence, 'utf8'))).toMatchObject({
      kind: 'seedlands-performance-window',
      status: 'FAIL',
      exitCode: 7,
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it('writes a default receipt even when the child does not declare a measurement', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'seedlands-measurement-window-default-'));
  const previousEvidence = process.env.SEEDLANDS_RESERVATION_EVIDENCE;
  const previousRun = process.env.SEEDLANDS_RESERVATION_RUN;
  try {
    delete process.env.SEEDLANDS_RESERVATION_EVIDENCE;
    delete process.env.SEEDLANDS_RESERVATION_RUN;
    const result = await runReservedCommand({
      command: process.execPath,
      args: ['-e', 'process.exit(0)'],
      lockDirectory: join(directory, 'lock'),
      rootDirectory: directory,
    });
    const receipt = join(directory, result.evidencePath);
    expect(existsSync(receipt)).toBe(true);
    expect(JSON.parse(readFileSync(receipt, 'utf8'))).toMatchObject({
      kind: 'seedlands-performance-window',
      status: 'PASS',
      windowId: result.windowId,
      exitCode: 0,
      measurement: { status: 'NOT_RECORDED' },
    });
  } finally {
    if (previousEvidence === undefined) delete process.env.SEEDLANDS_RESERVATION_EVIDENCE;
    else process.env.SEEDLANDS_RESERVATION_EVIDENCE = previousEvidence;
    if (previousRun === undefined) delete process.env.SEEDLANDS_RESERVATION_RUN;
    else process.env.SEEDLANDS_RESERVATION_RUN = previousRun;
    rmSync(directory, { recursive: true, force: true });
  }
});

it('keeps a direct local benchmark diagnostic without a complete reserved-window context', () => {
  const environment = { ...process.env };
  delete environment.SEEDLANDS_PERFORMANCE_WINDOW_ID;
  delete environment.SEEDLANDS_PERFORMANCE_WINDOW_EVIDENCE;
  delete environment.SEEDLANDS_PERFORMANCE_MEASUREMENT_DECLARATION;
  const result = spawnSync(
    process.execPath,
    [resolve('scripts/harness/local-benchmark.mjs'), '--owner', 'stdlib-world'],
    {
      encoding: 'utf8',
      env: { ...environment, SEEDLANDS_PERFORMANCE_WINDOW_RESERVED: '1' },
    },
  );
  expect(result.status).not.toBe(0);
  expect(result.stderr).toMatch(/complete machine performance window context/i);
});

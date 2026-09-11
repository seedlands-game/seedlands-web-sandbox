import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { generatePlan } from '../../../../../scripts/harness/plan.mjs';

it('records blocked downstream phases and a stable run identity when selection cannot start', () => {
  const run = spawnSync(process.execPath, ['scripts/harness/run.mjs', '--stage', 'invalid-fixture-stage'], {
    encoding: 'utf8',
  });
  expect(run.status).toBe(1);
  const path = run.stdout.match(/Harness BLOCKED: (harness\/results\/[a-z0-9-]+\/result\.json)/)?.[1];
  expect(path).toBeDefined();
  try {
    const record = JSON.parse(readFileSync(resolve(path!), 'utf8'));
    expect(record.runId).toMatch(/^[a-z0-9-]+$/);
    expect(record.configHash).toMatch(/^[a-f0-9]{64}$/);
    expect(record.status).toBe('BLOCKED');
    expect(record.phases).toMatchObject({
      selection: 'BLOCKED',
      static: 'BLOCKED',
      contracts: 'BLOCKED',
      classic: 'NOT_SELECTED',
    });
    expect(record.steps).toEqual([]);
  } finally {
    rmSync(dirname(resolve(path!)), { recursive: true, force: true });
  }
});

it('rejects a same-source plan that drops contracts or changes the change to documentation-only', () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'seedlands-plan-tamper-'));
  let receipt: string | undefined;
  try {
    const plan = generatePlan({ root: process.cwd(), all: true });
    expect(plan.status).toBe('READY');
    const path = resolve(directory, 'plan.json');
    writeFileSync(
      path,
      JSON.stringify({ ...plan, selectedContracts: [], selectedIntegrations: [], documentationOnly: true }),
    );
    const run = spawnSync(process.execPath, ['scripts/harness/run.mjs', '--stage', 'tests', '--plan', path], {
      encoding: 'utf8',
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('weakens the current required verification');
    receipt = run.stdout.match(/Harness BLOCKED: (harness\/results\/[a-z0-9-]+\/result\.json)/)?.[1];
    expect(receipt).toBeDefined();
    expect(JSON.parse(readFileSync(resolve(receipt!), 'utf8')).steps).toEqual([]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
    if (receipt) rmSync(dirname(resolve(receipt)), { recursive: true, force: true });
  }
});

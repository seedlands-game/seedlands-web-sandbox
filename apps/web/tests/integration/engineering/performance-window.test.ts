import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { runReservedCommand } from '../../../../../scripts/benchmark-window.mjs';

it('只给持锁子进程注入测量身份并生成绑定 declaration 的 receipt', () => {
  const directory = mkdtempSync(join(tmpdir(), 'seedlands-measurement-window-'));
  try {
    const lock = join(directory, 'lock');
    const childReadback = join(directory, 'child.json');
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
        resolve('apps/web/tests/integration/engineering/fixtures/performance-window-child.mjs'),
        childReadback,
        join(lock, 'owner.json'),
        measurementPath,
      ],
      { env: { ...process.env, SEEDLANDS_RESERVATION_EVIDENCE: evidence } },
    );
    expect(JSON.parse(readFileSync(childReadback, 'utf8'))).toMatchObject({ reserved: '1', locked: true });
    expect(JSON.parse(readFileSync(evidence, 'utf8'))).toMatchObject({
      kind: 'seedlands-performance-window',
      status: 'PASS',
      exitCode: 0,
      measurement: { status: 'RECORDED', path: measurementPath, runId: 'fixture-run', owner: 'web-runtime' },
    });
    expect(existsSync(lock)).toBe(false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it('子进程失败时仍写失败 receipt 并释放锁', () => {
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
    expect(JSON.parse(readFileSync(evidence, 'utf8'))).toMatchObject({ status: 'FAIL', exitCode: 7 });
    expect(existsSync(join(directory, 'lock'))).toBe(false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it('无 declaration 的成功命令只记录 NOT_RECORDED', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'seedlands-measurement-window-default-'));
  try {
    const result = await runReservedCommand({
      command: process.execPath,
      args: ['-e', 'process.exit(0)'],
      lockDirectory: join(directory, 'lock'),
      rootDirectory: directory,
    });
    expect(JSON.parse(readFileSync(join(directory, result.evidencePath), 'utf8'))).toMatchObject({
      status: 'PASS',
      measurement: { status: 'NOT_RECORDED' },
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

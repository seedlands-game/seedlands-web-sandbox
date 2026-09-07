import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { acquireBenchmarkWindow } from '../../../scripts/benchmark-window.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
const windowScript = path.join(root, 'scripts', 'benchmark-window.mjs');
const legacyScript = path.join(root, 'scripts', 'with-benchmark-reservation.mjs');
const helper = path.join(import.meta.dirname, 'fixtures', 'timed-child.mjs');

function launch(script, args, env = {}) {
  const child = spawn(process.execPath, [script, ...args], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => (stdout += chunk));
  child.stderr.on('data', (chunk) => (stderr += chunk));
  const done = new Promise((resolve) =>
    child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr })),
  );
  return { child, done };
}

async function waitFor(filePath, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await access(filePath);
      return;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`等待文件超时: ${filePath}`);
}

test('并发调用阻塞串行，旧 wrapper 仍可调用', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'benchmark-window-'));
  const lockDir = path.join(directory, 'lock');
  const events = path.join(directory, 'events.jsonl');
  const env = { SEEDLANDS_BENCHMARK_LOCK_DIR: lockDir, SEEDLANDS_RESERVATION_WAIT_MS: '2000' };
  const first = launch(legacyScript, [process.execPath, helper, events, '160', '0'], env);
  await waitFor(path.join(lockDir, 'owner.json'));
  const second = launch(windowScript, [
    '--lock-dir',
    lockDir,
    '--wait-timeout-ms',
    '2000',
    '--',
    process.execPath,
    helper,
    events,
    '0',
    '0',
  ]);
  assert.equal((await first.done).code, 0);
  assert.equal((await second.done).code, 0);
  const records = (await readFile(events, 'utf8')).trim().split('\n').map(JSON.parse);
  const firstEnd = records.find((entry) => entry.label === 'end' && entry.duration === 160).at;
  const secondStart = records.find((entry) => entry.label === 'start' && entry.duration === 0).at;
  assert.ok(secondStart >= firstEnd);
});

test('等待超时不抢占或删除旧格式/他人锁', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'benchmark-window-'));
  const lockDir = path.join(directory, 'lock');
  await mkdir(lockDir);
  const owner = { ownerThread: 'legacy', runId: 'legacy-run', pid: process.pid, startedAt: new Date().toISOString() };
  await writeFile(path.join(lockDir, 'owner.json'), JSON.stringify(owner));
  const result = await launch(windowScript, [
    '--lock-dir',
    lockDir,
    '--wait-timeout-ms',
    '30',
    '--',
    process.execPath,
    '-e',
    '',
  ]).done;
  assert.equal(result.code, 75);
  assert.deepEqual(JSON.parse(await readFile(path.join(lockDir, 'owner.json'), 'utf8')), owner);
});

test('取消等待不删除他人锁', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'benchmark-window-'));
  const lockDir = path.join(directory, 'lock');
  const events = path.join(directory, 'events.jsonl');
  const holder = launch(windowScript, ['--lock-dir', lockDir, '--', process.execPath, helper, events, '250', '0']);
  await waitFor(path.join(lockDir, 'owner.json'));
  const before = await readFile(path.join(lockDir, 'owner.json'), 'utf8');
  const waiter = launch(windowScript, [
    '--lock-dir',
    lockDir,
    '--wait-timeout-ms',
    '2000',
    '--',
    process.execPath,
    '-e',
    '',
  ]);
  await new Promise((resolve) => setTimeout(resolve, 100));
  waiter.child.kill('SIGTERM');
  assert.equal((await waiter.done).code, 143);
  assert.equal(await readFile(path.join(lockDir, 'owner.json'), 'utf8'), before);
  assert.equal((await holder.done).code, 0);
});

test('子进程失败时清理派生子孙并释放自有锁', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'benchmark-window-'));
  const lockDir = path.join(directory, 'lock');
  const events = path.join(directory, 'events.jsonl');
  const pidFile = path.join(directory, 'grandchild.pid');
  const result = await launch(windowScript, [
    '--lock-dir',
    lockDir,
    '--',
    process.execPath,
    helper,
    events,
    '0',
    '5',
    pidFile,
  ]).done;
  assert.equal(result.code, 5);
  const pid = Number(await readFile(pidFile, 'utf8'));
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.throws(() => process.kill(pid, 0), /ESRCH/);
  await assert.rejects(access(lockDir), /ENOENT/);
});

test('持有者收到信号时清理进程组并释放自有锁', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'benchmark-window-'));
  const lockDir = path.join(directory, 'lock');
  const events = path.join(directory, 'events.jsonl');
  const pidFile = path.join(directory, 'grandchild.pid');
  const holder = launch(windowScript, [
    '--lock-dir',
    lockDir,
    '--',
    process.execPath,
    helper,
    events,
    '1000',
    '0',
    pidFile,
  ]);
  await waitFor(pidFile);
  holder.child.kill('SIGTERM');
  assert.equal((await holder.done).code, 143);
  const pid = Number(await readFile(pidFile, 'utf8'));
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.throws(() => process.kill(pid, 0), /ESRCH/);
  await assert.rejects(access(lockDir), /ENOENT/);
});

test('owner 提交异常不递归删除后来出现的他人内容', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'benchmark-window-'));
  const lockDir = path.join(directory, 'lock');
  const sentinel = path.join(lockDir, 'foreign-owner');
  await assert.rejects(
    acquireBenchmarkWindow({
      lockDirectory: lockDir,
      beforeOwnerCommit: async () => {
        await writeFile(sentinel, 'foreign');
        const error = new Error('injected owner commit failure');
        error.code = 'EIO';
        throw error;
      },
    }),
    /injected owner commit failure/,
  );
  assert.equal(await readFile(sentinel, 'utf8'), 'foreign');
});

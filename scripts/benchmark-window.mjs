#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import { freemem, loadavg, totalmem } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { measurementSummary } from './harness/performance-window-proof.mjs';

export const defaultLockDirectory = '/tmp/seedlands-benchmark-reservation';
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const delay = (milliseconds) => new Promise((accept) => setTimeout(accept, milliseconds));

async function readOwner(lockDirectory) {
  try {
    return JSON.parse(await readFile(resolve(lockDirectory, 'owner.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
}

export async function acquireBenchmarkWindow({
  lockDirectory = defaultLockDirectory,
  waitTimeoutMs = 600_000,
  pollMs = 50,
  signal,
  ownerThread = 'seedlands-performance-validator',
  runId = randomUUID(),
} = {}) {
  const absoluteLock = resolve(lockDirectory);
  const started = Date.now();
  const owner = { version: 2, ownerThread, runId, pid: process.pid, startedAt: new Date().toISOString() };
  while (true) {
    if (signal?.aborted) throw Object.assign(new Error('等待性能窗口已取消'), { code: 'CANCELLED' });
    let created = false;
    let temporaryOwner;
    try {
      await mkdir(absoluteLock, { mode: 0o700 });
      created = true;
      temporaryOwner = resolve(absoluteLock, 'owner.' + owner.runId + '.tmp');
      await writeFile(temporaryOwner, JSON.stringify(owner, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      await rename(temporaryOwner, resolve(absoluteLock, 'owner.json'));
      break;
    } catch (error) {
      if (created) {
        if (temporaryOwner) await rm(temporaryOwner, { force: true });
        try {
          await rmdir(absoluteLock);
        } catch (cleanup) {
          if (cleanup.code !== 'ENOENT' && cleanup.code !== 'ENOTEMPTY') throw cleanup;
        }
        throw error;
      }
      if (error.code !== 'EEXIST') throw error;
      if (Date.now() - started >= waitTimeoutMs) {
        const current = await readOwner(absoluteLock);
        throw Object.assign(new Error('等待性能窗口超时；当前 owner=' + (current?.runId ?? 'unknown')), {
          code: 'TIMEOUT',
        });
      }
      await delay(Math.min(pollMs, Math.max(1, waitTimeoutMs - (Date.now() - started))));
    }
  }
  let released = false;
  return {
    owner,
    waitedMs: Date.now() - started,
    async release() {
      if (released) return false;
      released = true;
      const current = await readOwner(absoluteLock);
      if (current?.pid !== owner.pid || current?.runId !== owner.runId) return false;
      await rm(resolve(absoluteLock, 'owner.json'), { force: true });
      try {
        await rmdir(absoluteLock);
      } catch (error) {
        if (error.code !== 'ENOENT' && error.code !== 'ENOTEMPTY') throw error;
      }
      return true;
    },
  };
}

function killProcessGroup(pid, signal) {
  if (!Number.isSafeInteger(pid)) return false;
  try {
    process.kill(process.platform === 'win32' ? pid : -pid, signal);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

async function writeReceipt(path, receipt) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = path + '.' + receipt.windowId + '.tmp';
  await writeFile(temporary, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
  await rename(temporary, path);
}

export async function runReservedCommand({
  command,
  args = [],
  lockDirectory,
  waitTimeoutMs,
  pollMs,
  ownerThread,
  evidencePath,
  rootDirectory = repositoryRoot,
} = {}) {
  if (!command) throw new Error('缺少性能命令');
  const windowId = process.env.SEEDLANDS_RESERVATION_RUN ?? randomUUID();
  const receiptPath =
    evidencePath ??
    process.env.SEEDLANDS_RESERVATION_EVIDENCE ??
    'harness/results/performance-windows/' + windowId + '.json';
  const absoluteReceiptPath = resolve(rootDirectory, receiptPath);
  const declarationPath = receiptPath + '.measurement.json';
  const startedAt = new Date().toISOString();
  const controller = new AbortController();
  let receivedSignal = null;
  const waitingHandlers = new Map();
  for (const signal of ['SIGINT', 'SIGTERM']) {
    const handler = () => {
      receivedSignal = signal;
      controller.abort();
    };
    waitingHandlers.set(signal, handler);
    process.once(signal, handler);
  }
  let reservation;
  try {
    reservation = await acquireBenchmarkWindow({
      lockDirectory,
      waitTimeoutMs,
      pollMs,
      ownerThread,
      runId: windowId,
      signal: controller.signal,
    });
  } catch (error) {
    for (const [signal, handler] of waitingHandlers) process.off(signal, handler);
    const exitCode =
      error.code === 'TIMEOUT' ? 75 : error.code === 'CANCELLED' ? (receivedSignal === 'SIGINT' ? 130 : 143) : 1;
    await writeReceipt(absoluteReceiptPath, {
      schemaVersion: 1,
      kind: 'seedlands-performance-window',
      status: 'FAIL',
      windowId,
      ownerThread: ownerThread ?? 'seedlands-performance-validator',
      startedAt,
      endedAt: new Date().toISOString(),
      exitCode,
      error: error.message,
      measurement: { status: 'NOT_RECORDED' },
      samples: [],
    });
    return { exitCode, windowId, evidencePath: receiptPath };
  }
  const samples = [];
  const sample = () =>
    samples.push({
      at: new Date().toISOString(),
      loadAverage: loadavg(),
      freeMemoryBytes: freemem(),
      totalMemoryBytes: totalmem(),
    });
  sample();
  const timer = setInterval(sample, 5000);
  const child = spawn(command, args, {
    stdio: 'inherit',
    detached: process.platform !== 'win32',
    env: {
      ...process.env,
      SEEDLANDS_PERFORMANCE_WINDOW_RESERVED: '1',
      SEEDLANDS_PERFORMANCE_WINDOW_ID: windowId,
      SEEDLANDS_PERFORMANCE_WINDOW_EVIDENCE: receiptPath,
      SEEDLANDS_PERFORMANCE_MEASUREMENT_DECLARATION: declarationPath,
    },
  });
  for (const [signal, handler] of waitingHandlers) {
    process.off(signal, handler);
    const forwarding = () => {
      receivedSignal = signal;
      killProcessGroup(child.pid, signal);
    };
    waitingHandlers.set(signal, forwarding);
    process.once(signal, forwarding);
  }
  const outcome = await new Promise((accept) => {
    child.once('error', (error) => accept({ code: 1, error }));
    child.once('exit', (code, signal) => accept({ code, signal }));
  });
  clearInterval(timer);
  sample();
  if (killProcessGroup(child.pid, 'SIGTERM')) {
    await delay(60);
    killProcessGroup(child.pid, 'SIGKILL');
  }
  await reservation.release();
  for (const [signal, handler] of waitingHandlers) process.off(signal, handler);
  let measurement = { status: 'NOT_RECORDED' };
  try {
    measurement = measurementSummary(declarationPath, { rootDirectory });
  } catch (error) {
    if (!String(error).includes('missing or unreadable')) measurement = { status: 'INVALID', error: error.message };
  }
  const exitCode = outcome.code ?? { SIGINT: 130, SIGTERM: 143 }[outcome.signal ?? receivedSignal] ?? 1;
  await writeReceipt(absoluteReceiptPath, {
    schemaVersion: 1,
    kind: 'seedlands-performance-window',
    status: exitCode === 0 && !outcome.error ? 'PASS' : 'FAIL',
    ...reservation.owner,
    windowId,
    evidencePath: receiptPath,
    waitedMs: reservation.waitedMs,
    endedAt: new Date().toISOString(),
    exitCode,
    signal: outcome.signal ?? receivedSignal,
    measurement,
    samples,
  });
  return { exitCode, windowId, evidencePath: receiptPath };
}

function parseArguments(argv) {
  const separator = argv.indexOf('--');
  const flags = separator >= 0 ? argv.slice(0, separator) : [];
  const command = separator >= 0 ? argv.slice(separator + 1) : argv;
  const options = {
    lockDirectory: process.env.SEEDLANDS_BENCHMARK_LOCK_DIR ?? defaultLockDirectory,
    waitTimeoutMs: Number(process.env.SEEDLANDS_RESERVATION_WAIT_MS ?? 600000),
    pollMs: 50,
  };
  for (let index = 0; index < flags.length; index += 2) {
    const key = flags[index],
      value = flags[index + 1];
    if (key === '--lock-dir') options.lockDirectory = value;
    else if (key === '--wait-timeout-ms') options.waitTimeoutMs = Number(value);
    else if (key === '--poll-ms') options.pollMs = Number(value);
    else if (key === '--owner-thread') options.ownerThread = value;
    else throw new Error('未知选项: ' + key);
  }
  return { ...options, command: command[0], args: command.slice(1) };
}

export async function main(argv = process.argv.slice(2)) {
  if (!argv.length || argv.includes('--help')) {
    process.stdout.write('用法: benchmark-window.mjs [--wait-timeout-ms <ms>] -- <command> [args...]\n');
    return argv.length ? 0 : 1;
  }
  return (await runReservedCommand(parseArguments(argv))).exitCode;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = await main();

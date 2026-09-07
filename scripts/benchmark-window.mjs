#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import { freemem, loadavg, totalmem } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const defaultLockDirectory = '/tmp/seedlands-benchmark-reservation';
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function readOwner(lockDirectory) {
  try {
    return JSON.parse(await readFile(path.join(lockDirectory, 'owner.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
}

function sameOwner(left, right) {
  return left?.pid === right.pid && left?.runId === right.runId;
}

export async function acquireBenchmarkWindow({
  lockDirectory = defaultLockDirectory,
  waitTimeoutMs = 10 * 60 * 1000,
  pollMs = 50,
  signal,
  ownerThread = process.env.CODEX_THREAD_ID ?? 'unknown',
  runId = process.env.SEEDLANDS_RESERVATION_RUN ?? randomUUID(),
  beforeOwnerCommit,
} = {}) {
  const absoluteLock = path.resolve(lockDirectory);
  const started = Date.now();
  const owner = {
    version: 2,
    ownerThread,
    runId,
    pid: process.pid,
    startedAt: new Date().toISOString(),
  };

  while (true) {
    if (signal?.aborted) {
      const error = new Error('等待性能窗口已取消');
      error.code = 'CANCELLED';
      throw error;
    }
    let created = false;
    let temporaryOwner;
    try {
      await mkdir(absoluteLock, { mode: 0o700 });
      created = true;
      const ownerPath = path.join(absoluteLock, 'owner.json');
      temporaryOwner = path.join(absoluteLock, `owner.${owner.runId}.tmp`);
      await beforeOwnerCommit?.(absoluteLock);
      await writeFile(temporaryOwner, `${JSON.stringify(owner, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      await rename(temporaryOwner, ownerPath);
      break;
    } catch (error) {
      if (created) {
        if (temporaryOwner) await rm(temporaryOwner, { force: true });
        try {
          await rmdir(absoluteLock);
        } catch (cleanupError) {
          if (cleanupError.code !== 'ENOENT' && cleanupError.code !== 'ENOTEMPTY') throw cleanupError;
        }
        throw error;
      }
      if (error.code !== 'EEXIST') throw error;
      if (Date.now() - started >= waitTimeoutMs) {
        const current = await readOwner(absoluteLock);
        const timeout = new Error(`等待性能窗口超时；当前 owner=${current?.runId ?? 'unknown'}`);
        timeout.code = 'TIMEOUT';
        throw timeout;
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
      if (!sameOwner(current, owner)) return false;
      await rm(path.join(absoluteLock, 'owner.json'), { force: true });
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
  try {
    process.kill(process.platform === 'win32' ? pid : -pid, signal);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

async function cleanProcessGroup(pid) {
  if (!killProcessGroup(pid, 'SIGTERM')) return;
  await delay(60);
  killProcessGroup(pid, 'SIGKILL');
}

export async function runReservedCommand({
  command,
  args = [],
  lockDirectory,
  waitTimeoutMs,
  pollMs,
  ownerThread,
  evidencePath = process.env.SEEDLANDS_RESERVATION_EVIDENCE,
} = {}) {
  if (!command) throw new Error('缺少性能命令');
  const controller = new AbortController();
  let receivedSignal = null;
  const handlers = new Map();
  for (const name of ['SIGINT', 'SIGTERM']) {
    const handler = () => {
      receivedSignal = name;
      controller.abort();
    };
    handlers.set(name, handler);
    process.once(name, handler);
  }

  let reservation;
  try {
    reservation = await acquireBenchmarkWindow({
      lockDirectory,
      waitTimeoutMs,
      pollMs,
      ownerThread,
      signal: controller.signal,
    });
  } catch (error) {
    for (const [name, handler] of handlers) process.off(name, handler);
    if (error.code === 'CANCELLED') return { exitCode: receivedSignal === 'SIGINT' ? 130 : 143 };
    if (error.code === 'TIMEOUT') {
      process.stderr.write(`${error.message}\n`);
      return { exitCode: 75 };
    }
    throw error;
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
    env: process.env,
    detached: process.platform !== 'win32',
  });
  for (const [name, previous] of handlers) {
    process.off(name, previous);
    const handler = () => {
      receivedSignal = name;
      killProcessGroup(child.pid, name);
    };
    handlers.set(name, handler);
    process.once(name, handler);
  }

  const outcome = await new Promise((resolve) => {
    child.once('error', (error) => resolve({ code: 1, error }));
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  clearInterval(timer);
  sample();
  try {
    await cleanProcessGroup(child.pid);
  } finally {
    await reservation.release();
    for (const [name, handler] of handlers) process.off(name, handler);
  }
  if (evidencePath) {
    await writeFile(
      evidencePath,
      `${JSON.stringify(
        {
          ...reservation.owner,
          waitedMs: reservation.waitedMs,
          endedAt: new Date().toISOString(),
          exitCode: outcome.code,
          signal: outcome.signal ?? receivedSignal,
          samples,
        },
        null,
        2,
      )}\n`,
    );
  }
  if (outcome.error) process.stderr.write(`${String(outcome.error)}\n`);
  const signalCode = { SIGINT: 130, SIGTERM: 143 }[outcome.signal ?? receivedSignal];
  return { exitCode: outcome.code ?? signalCode ?? 1 };
}

function parseArguments(argv) {
  const options = {
    lockDirectory: process.env.SEEDLANDS_BENCHMARK_LOCK_DIR ?? defaultLockDirectory,
    waitTimeoutMs: Number(process.env.SEEDLANDS_RESERVATION_WAIT_MS ?? 600_000),
    pollMs: 50,
  };
  const separator = argv.indexOf('--');
  const optionArgs = separator >= 0 ? argv.slice(0, separator) : [];
  const commandArgs = separator >= 0 ? argv.slice(separator + 1) : argv;
  for (let index = 0; index < optionArgs.length; index += 2) {
    const key = optionArgs[index];
    const value = optionArgs[index + 1];
    if (key === '--lock-dir') options.lockDirectory = value;
    else if (key === '--wait-timeout-ms') options.waitTimeoutMs = Number(value);
    else if (key === '--poll-ms') options.pollMs = Number(value);
    else if (key === '--owner-thread') options.ownerThread = value;
    else throw new Error(`未知选项: ${key}`);
  }
  if (!Number.isFinite(options.waitTimeoutMs) || options.waitTimeoutMs < 0) throw new Error('wait timeout 无效');
  return { ...options, command: commandArgs[0], args: commandArgs.slice(1) };
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.length === 0) {
    process.stdout.write(
      '用法: benchmark-window.mjs [--lock-dir <dir>] [--wait-timeout-ms <ms>] -- <command> [args...]\n',
    );
    return argv.length === 0 ? 1 : 0;
  }
  const result = await runReservedCommand(parseArguments(argv));
  return result.exitCode;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = await main();

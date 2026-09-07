#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareRun, readRunStatus, requestStop, runBatch, waitForRun } from './lib/batch-runtime.mjs';
import { runSafeCli } from './lib/safe-cli.mjs';

const help = `用法:
  batch-runtime.mjs prepare --config <json> --input <json> --run-dir <dir>
  batch-runtime.mjs run|start|status|stop|audit --run-dir <dir>
  batch-runtime.mjs wait --run-dir <dir> [--timeout-ms <n>]`;

await runSafeCli(
  async () => {
    const args = process.argv.slice(2);
    const command = args.shift();
    const value = (name, fallback) => {
      const index = args.indexOf(name);
      return index >= 0 ? args[index + 1] : fallback;
    };
    if (!command || command === 'help' || command === '--help' || args.includes('--help')) {
      console.log(help);
      process.exitCode = command ? 0 : 1;
      return;
    }
    const runDir = value('--run-dir');
    if (!runDir) throw new Error('--run-dir 缺失');
    let result;
    if (command === 'prepare')
      result = await prepareRun({ configPath: value('--config'), inputPath: value('--input'), runDir });
    else if (command === 'run') result = await runBatch({ runDir });
    else if (command === 'status') result = await readRunStatus(runDir);
    else if (command === 'stop') result = await requestStop(runDir);
    else if (command === 'wait')
      result = await waitForRun(runDir, { timeoutMs: Number(value('--timeout-ms', 30_000)) });
    else if (command === 'audit') {
      process.stdout.write(await readFile(path.join(path.resolve(runDir), 'audit.jsonl'), 'utf8'));
      return;
    } else if (command === 'start') {
      const child = spawn(
        process.execPath,
        [fileURLToPath(import.meta.url), 'run', '--run-dir', path.resolve(runDir)],
        { detached: true, stdio: 'ignore' },
      );
      child.unref();
      result = { started: true, pid: child.pid, runDir: path.resolve(runDir) };
    } else throw new Error(`未知命令: ${command}`);
    console.log(JSON.stringify(result, null, 2));
  },
  {
    code: 'BATCH_RUNTIME_FAILED',
    stage: 'command',
  },
);

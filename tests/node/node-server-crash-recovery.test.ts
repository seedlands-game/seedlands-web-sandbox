import { afterAll, beforeAll, expect, it } from 'vitest';
import { build } from 'esbuild';
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
let directory: string;
let runner: string;

beforeAll(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'seedlands-crash-recovery-'));
  const artifact = resolve(directory, 'artifact');
  const builder = pathToFileURL(resolve('scripts/build-node-server.mjs')).href;
  await run(process.execPath, [
    '--input-type=module',
    '-e',
    `import { buildNodeServer } from ${JSON.stringify(builder)}; await buildNodeServer(${JSON.stringify(artifact)});`,
  ]);
  // 仅测试临时入口；实际五个运行产物仍来自正式构建，不依赖 TS loader。
  await build({
    entryPoints: [resolve('src/node/server/node-server-runtime.ts')],
    outfile: resolve(artifact, 'runtime-module.js'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
  });
  runner = resolve(artifact, 'crash-runner.mjs');
  await writeFile(
    runner,
    `
import { createNodeServerRuntime } from './runtime-module.js';
const runtime = await createNodeServerRuntime({
  seedText: 'dedicated-hard-crash', dataDirectory: process.argv[3], computeMode: 'worker-thread',
  hostLimits: { saveIntervalMs: 60000 },
  entries: {
    authority: new URL('./node-authority-worker.js', import.meta.url),
    persistence: new URL('./node-persistence-worker.js', import.meta.url),
    worker: new URL('./node-compute-worker.js', import.meta.url),
    child: new URL('./node-compute-child.js', import.meta.url),
  },
});
if (process.argv[2] === 'crash') {
  const first = await runtime.authority.performAction({ type: 'select-hotbar', slot: 2 }, 0);
  if (first.status !== 'executed') throw new Error('first action not executed');
  const checkpoint = await runtime.authority.requestCheckpoint();
  const second = await runtime.authority.performAction({ type: 'select-hotbar', slot: 3 }, 1);
  if (second.status !== 'executed') throw new Error('second action not executed');
  console.log(JSON.stringify({ kind: 'armed', epoch: runtime.epoch, checkpoint }));
  await new Promise(() => {});
} else {
  const gameplay = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('no gameplay publication')), 10000);
    const off = runtime.authority.subscribePublication((publication) => {
      if (publication.gameplay) { clearTimeout(timeout); off(); resolve(publication.gameplay); }
    });
  });
  const diagnostics = await runtime.authority.readDiagnostics();
  console.log(JSON.stringify({ kind: 'recovered', epoch: runtime.epoch,
    selectedSlot: gameplay.player.selectedSlot, durableCommitSequence: diagnostics.host.durableCommitSequence }));
  await runtime.stop();
}
`,
  );
}, 30_000);

afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

function start(phase: 'crash' | 'recover') {
  const child = spawn(process.execPath, [runner, phase, resolve(directory, 'world')], {
    cwd: directory,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  let output = '';
  child.stderr.on('data', (bytes: Buffer) => {
    stderr += bytes.toString();
  });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((accept, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => accept({ code, signal }));
  });
  const marker = new Promise<Record<string, unknown>>((accept, reject) => {
    child.stdout.on('data', (bytes: Buffer) => {
      output += bytes.toString();
      const lines = output.split('\n');
      output = lines.pop()!;
      for (const line of lines) {
        try {
          accept(JSON.parse(line) as Record<string, unknown>);
        } catch {
          reject(new Error('invalid crash fixture output'));
        }
      }
    });
    child.once('error', reject);
    child.once('exit', () => reject(new Error(`crash fixture exited before marker: ${stderr}`)));
  });
  const timeout = setTimeout(() => child.kill('SIGKILL'), 25_000);
  const cleanup = async () => {
    clearTimeout(timeout);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await exited;
  };
  return { child, marker, exited, cleanup, stderr: () => stderr };
}

it('真实进程SIGKILL后只恢复最后durable检查点，丢弃尚未保存的后续动作并更换epoch', async () => {
  const first = start('crash');
  let armed: Record<string, unknown>;
  try {
    armed = await first.marker;
    expect(armed.kind).toBe('armed');
    first.child.kill('SIGKILL');
    expect((await first.exited).signal).toBe('SIGKILL');
  } finally {
    await first.cleanup();
  }
  const second = start('recover');
  try {
    const recovered = await second.marker;
    expect(recovered.kind).toBe('recovered');
    expect(recovered.epoch).not.toBe(armed!.epoch);
    expect(recovered.selectedSlot).toBe(2);
    expect(recovered.durableCommitSequence).toBe((armed!.checkpoint as { commitSequence: number }).commitSequence);
    expect((await second.exited).code, second.stderr()).toBe(0);
  } finally {
    await second.cleanup();
  }
}, 60_000);

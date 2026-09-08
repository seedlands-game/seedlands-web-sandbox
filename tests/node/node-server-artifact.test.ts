import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
let directory: string;
let artifact: string;
const startAndStop = async (mode: string) => {
  const child = spawn(
    process.execPath,
    [
      resolve(artifact, 'node-server.js'),
      '--data-directory',
      resolve(directory, `world-${mode}`),
      '--seed',
      'dedicated-artifact',
      '--compute',
      mode,
    ],
    { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let output = '';
  let errors = '';
  const exit = new Promise<number | null>((accept, reject) => {
    child.once('error', reject);
    child.once('exit', accept);
  });
  const ready = new Promise<void>((accept, reject) => {
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes('"kind":"ready"')) accept();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      errors += chunk.toString();
    });
    child.once('exit', (code) => {
      if (!output.includes('"kind":"ready"')) reject(new Error(`Startup exit ${code}: ${errors}`));
    });
  });
  const timeout = setTimeout(() => {
    child.kill('SIGKILL');
  }, 25_000);
  try {
    await ready;
    child.kill('SIGTERM');
    expect(await exit, errors).toBe(0);
    expect(output).toContain('"kind":"stopped"');
    return output
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  } finally {
    clearTimeout(timeout);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
};

beforeAll(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'seedlands-artifact-'));
  artifact = resolve(directory, 'artifact');
  const builder = pathToFileURL(resolve('scripts/build-node-server.mjs')).href;
  await run(process.execPath, [
    '--input-type=module',
    '-e',
    `import { buildNodeServer } from ${JSON.stringify(builder)}; await buildNodeServer(${JSON.stringify(artifact)});`,
  ]);
}, 30_000);
afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe('Node 独立离线产物', () => {
  it('无需 Vite/源码/依赖目录即可读取帮助和校验产物 hash', async () => {
    const help = await run(process.execPath, [resolve(artifact, 'node-server.js'), '--help'], { cwd: directory });
    expect(help.stdout).toContain('--data-directory');
    const manifest = JSON.parse(await readFile(resolve(artifact, 'artifact-manifest.json'), 'utf8'));
    expect(manifest.files).toHaveLength(5);
    expect(manifest.lockSha256).toMatch(/^[a-f0-9]{64}$/);
    for (const file of manifest.files) {
      const bytes = await readFile(resolve(artifact, file.name));
      expect(bytes.byteLength).toBe(file.bytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256);
    }
  });
  it.each(['worker-thread', 'child-process'])(
    '%s 产物实际启动、信号关停、重新恢复',
    async (mode) => {
      const first = await startAndStop(mode);
      const second = await startAndStop(mode);
      expect(first[0].authorityThreadId).toBeGreaterThan(0);
      expect(first[0].persistenceThreadId).toBeGreaterThan(0);
      expect(first[0].authorityThreadId).not.toBe(first[0].persistenceThreadId);
      expect(first[0].epoch).not.toBe(second[0].epoch);
      expect(second[0].durableCommitSequence).toBeGreaterThanOrEqual(0);
    },
    60_000,
  );
});

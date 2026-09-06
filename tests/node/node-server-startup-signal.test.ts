import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile, spawn } from 'node:child_process';
import { access, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
let directory: string;
let artifact: string;
let release: string;

async function waitFor(check: () => boolean, description: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error(`等待 ${description} 超时。`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function startAndStopNormally(dataDirectory: string): Promise<void> {
  const child = spawn(
    process.execPath,
    [
      resolve(artifact, 'node-server.js'),
      '--data-directory',
      dataDirectory,
      '--seed',
      'startup-signal',
      '--compute',
      'child-process',
    ],
    {
      cwd: directory,
      env: { ...process.env, SEEDLANDS_AUTHORITY_START_RELEASE: release },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let output = '';
  let errors = '';
  child.stdout.on('data', (bytes: Buffer) => {
    output += bytes.toString();
  });
  child.stderr.on('data', (bytes: Buffer) => {
    errors += bytes.toString();
  });
  const exited = new Promise<number | null>((resolveExit, reject) => {
    child.once('exit', resolveExit);
    child.once('error', reject);
  });
  try {
    await waitFor(() => output.includes('"kind":"ready"'), '重开后的 ready');
    child.kill('SIGTERM');
    expect(await exited, errors).toBe(0);
    expect(output).toContain('"kind":"stopped"');
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
}

beforeAll(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'seedlands-startup-signal-'));
  artifact = resolve(directory, 'artifact');
  release = resolve(directory, 'allow-authority-start');
  const builder = pathToFileURL(resolve('scripts/build-node-server.mjs')).href;
  await run(process.execPath, [
    '--input-type=module',
    '-e',
    `import { buildNodeServer } from ${JSON.stringify(builder)}; await buildNodeServer(${JSON.stringify(artifact)});`,
  ]);
  await rename(resolve(artifact, 'node-authority-worker.js'), resolve(artifact, 'node-authority-worker-actual.js'));
  await writeFile(
    resolve(artifact, 'node-authority-worker.js'),
    `import { existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
const release = process.env.SEEDLANDS_AUTHORITY_START_RELEASE;
if (!release) throw new Error('missing authority startup release path');
process.stdout.write(JSON.stringify({ kind: 'authority-starting' }) + '\\n');
while (!existsSync(release)) await sleep(5);
await import('./node-authority-worker-actual.js');
`,
  );
}, 30_000);

afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe('Node CLI 启动中信号', () => {
  it('Authority ready 前的 SIGTERM 不发布 ready，并在解除屏障后有序释放存储锁', async () => {
    const dataDirectory = resolve(directory, 'world');
    const child = spawn(
      process.execPath,
      [
        resolve(artifact, 'node-server.js'),
        '--data-directory',
        dataDirectory,
        '--seed',
        'startup-signal',
        '--compute',
        'child-process',
      ],
      {
        cwd: directory,
        env: { ...process.env, SEEDLANDS_AUTHORITY_START_RELEASE: release },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let output = '';
    let errors = '';
    child.stdout.on('data', (bytes: Buffer) => {
      output += bytes.toString();
    });
    child.stderr.on('data', (bytes: Buffer) => {
      errors += bytes.toString();
    });
    const exited = new Promise<number | null>((resolveExit, reject) => {
      child.once('exit', resolveExit);
      child.once('error', reject);
    });
    try {
      await waitFor(() => output.includes('"kind":"authority-starting"'), 'Authority 启动屏障');
      child.kill('SIGTERM');
      // 旧入口在此时尚未安装 listener；新 lifecycle 已先记录关停意图。
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(child.exitCode).toBeNull();
      await writeFile(release, 'release\n');
      expect(await exited, errors).toBe(0);
      expect(output).not.toContain('"kind":"ready"');
      expect(output).toContain('"kind":"stopped"');
      await expect(access(resolve(dataDirectory, 'LOCK'))).rejects.toMatchObject({ code: 'ENOENT' });
      await startAndStopNormally(dataDirectory);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
  }, 60_000);
});

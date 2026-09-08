import { afterEach, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

it('跨工作树采样互斥，竞争者不执行且不删持有者锁，结束后释放', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'seedlands-bench-lock-'));
  directories.push(directory);
  const lock = resolve(directory, 'reservation');
  const script = resolve('scripts/run-exclusive-benchmark.mjs');
  const args = [
    script,
    '--owner',
    'test-task',
    '--label',
    'first',
    '--lock-directory',
    lock,
    '--',
    process.execPath,
    '-e',
    "process.stdout.write('READY\\n');process.stdin.once('data',()=>process.exit(0));",
  ];
  const first = spawn(process.execPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  const firstExit = new Promise<number | null>((accept, reject) => {
    first.once('exit', accept);
    first.once('error', reject);
  });
  try {
    await new Promise<void>((accept, reject) => {
      first.stdout.on('data', (bytes: Buffer) => {
        if (bytes.toString().includes('READY')) accept();
      });
      first.once('error', reject);
      first.once('exit', (code) => {
        reject(new Error(`Holder exited ${code}`));
      });
    });
    const token = JSON.parse(await readFile(resolve(lock, 'owner.json'), 'utf8')).token;
    const second = spawn(
      process.execPath,
      [
        script,
        '--owner',
        'test-contender',
        '--label',
        'second',
        '--lock-directory',
        lock,
        '--',
        process.execPath,
        '-e',
        'process.exit(42)',
      ],
      { stdio: 'ignore' },
    );
    expect(
      await new Promise((accept, reject) => {
        second.once('exit', accept);
        second.once('error', reject);
      }),
    ).toBe(75);
    expect(JSON.parse(await readFile(resolve(lock, 'owner.json'), 'utf8')).token).toBe(token);
    first.stdin.write('finish');
    expect(await firstExit).toBe(0);
    await expect(stat(lock)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    if (first.exitCode === null) first.kill('SIGTERM');
  }
});

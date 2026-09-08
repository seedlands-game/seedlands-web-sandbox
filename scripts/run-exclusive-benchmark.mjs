import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const DEFAULT_LOCK_DIRECTORY = '/tmp/seedlands-benchmark-reservation';

function parse(args) {
  const options = { owner: '', label: '', lockDirectory: DEFAULT_LOCK_DIRECTORY, command: [] };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === '--') {
      options.command = args.slice(index + 1);
      break;
    }
    if (!['--owner', '--label', '--lock-directory'].includes(flag) || !args[index + 1])
      throw new Error('用法：--owner <task-id> --label <run-id> [--lock-directory <目录>] -- <命令> [参数]');
    const value = args[++index];
    if (flag === '--owner') options.owner = value;
    else if (flag === '--label') options.label = value;
    else options.lockDirectory = resolve(value);
  }
  if (!options.owner || !options.label || !options.command.length)
    throw new Error('必须声明采样所有者、run id 和命令。');
  return options;
}

async function main() {
  const options = parse(process.argv.slice(2));
  const ownerFile = resolve(options.lockDirectory, 'owner.json');
  const lease = {
    version: 1,
    owner: options.owner,
    label: options.label,
    pid: process.pid,
    token: randomUUID(),
    startedAt: new Date().toISOString(),
  };
  try {
    await mkdir(options.lockDirectory);
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    process.stderr.write('性能资源已被预留；本次命令未启动。先与持有任务协调，禁止自动抢占或删除锁。\n');
    process.exitCode = 75;
    return;
  }
  let ownerWritten = false;
  try {
    await writeFile(ownerFile, `${JSON.stringify(lease)}\n`, { flag: 'wx', mode: 0o600 });
    ownerWritten = true;
    const child = spawn(options.command[0], options.command.slice(1), {
      stdio: 'inherit',
      detached: process.platform !== 'win32',
    });
    const forward = (signal) => {
      if (!child.pid) return;
      try {
        if (process.platform === 'win32') child.kill(signal);
        else process.kill(-child.pid, signal);
      } catch (error) {
        if (error?.code !== 'ESRCH') throw error;
      }
    };
    const interrupt = () => forward('SIGINT');
    const terminate = () => forward('SIGTERM');
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', terminate);
    try {
      const result = await new Promise((accept, reject) => {
        child.once('error', reject);
        child.once('exit', (code, signal) => accept({ code, signal }));
      });
      process.exitCode = result.code ?? (result.signal === 'SIGINT' ? 130 : 143);
    } finally {
      forward('SIGTERM');
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', terminate);
    }
  } finally {
    if (ownerWritten) {
      const current = JSON.parse(await readFile(ownerFile, 'utf8'));
      if (current.token === lease.token && current.pid === lease.pid) {
        await unlink(ownerFile);
        await rmdir(options.lockDirectory);
      }
    } else await rmdir(options.lockDirectory);
  }
}

void main().catch((error) => {
  process.stderr.write(`性能资源预留失败：${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

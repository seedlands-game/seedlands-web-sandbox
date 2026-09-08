import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { open, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { readBoundedFile, syncDirectory } from './durable-files';

type LockBody = Readonly<{ version: 1; pid: number; hostname: string; token: string; createdAt: string }>;
type LockAcquireHooks = Readonly<{ afterStaleObserved?: () => Promise<void> }>;

const MAX_LOCK_BYTES = 16 * 1_024;

const lockIsLive = (body: LockBody): boolean => {
  if (body.hostname !== hostname()) throw new Error('无法核验其他主机留下的写者锁，拒绝自动抢占。');
  try {
    process.kill(body.pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') return false;
    if (code === 'EPERM') return true;
    throw new Error('无法核验现有写者锁的进程身份。', { cause: error });
  }
};

const parseLock = (raw: string): LockBody => {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error('现有写者锁损坏，拒绝自动抢占。', { cause: error });
  }
  const body = value as Partial<LockBody>;
  if (
    body.version !== 1 ||
    !Number.isSafeInteger(body.pid) ||
    body.pid! <= 0 ||
    typeof body.hostname !== 'string' ||
    typeof body.token !== 'string' ||
    !body.token ||
    typeof body.createdAt !== 'string'
  )
    throw new Error('现有写者锁格式无效，拒绝自动抢占。');
  return body as LockBody;
};

export class FileStoreLock {
  private closed = false;

  private constructor(
    private readonly directory: string,
    private readonly body: LockBody,
  ) {}

  static async acquire(directory: string, hooks: LockAcquireHooks = {}): Promise<FileStoreLock> {
    const path = join(directory, 'LOCK');
    const reclaimPath = join(directory, 'LOCK-RECLAIM');
    await assertNoReclaimLock(reclaimPath);
    const body = createLockBody();
    try {
      await writeExclusiveLock(path, body);
      await syncDirectory(directory);
      return new FileStoreLock(directory, body);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const observed = parseLock((await readBoundedFile(path, MAX_LOCK_BYTES)).toString('utf8'));
      if (lockIsLive(observed)) throw new Error(`目录已有活动写者锁（PID ${observed.pid}）。`, { cause: error });
      await hooks.afterStaleObserved?.();
      const reclaim = createLockBody();
      try {
        await writeExclusiveLock(reclaimPath, reclaim);
        await syncDirectory(directory);
      } catch (reclaimError) {
        if ((reclaimError as NodeJS.ErrnoException).code === 'EEXIST')
          throw new Error('另一个进程正在回收过期写者锁，拒绝竞争启动。', { cause: reclaimError });
        throw reclaimError;
      }
      try {
        const current = parseLock((await readBoundedFile(path, MAX_LOCK_BYTES)).toString('utf8'));
        if (!sameLock(current, observed) || lockIsLive(current))
          throw new Error('写者锁在回收前已改变，拒绝删除当前锁。', { cause: error });
        await unlink(path);
        await syncDirectory(directory);
        await writeExclusiveLock(path, body);
        await syncDirectory(directory);
        return new FileStoreLock(directory, body);
      } finally {
        await releaseReclaimLock(directory, reclaimPath, reclaim);
      }
    }
  }

  async release(): Promise<void> {
    if (this.closed) return;
    const path = join(this.directory, 'LOCK');
    const existing = parseLock((await readBoundedFile(path, MAX_LOCK_BYTES)).toString('utf8'));
    if (existing.token !== this.body.token || existing.pid !== this.body.pid)
      throw new Error('写者锁身份已改变，拒绝释放其他实例的锁。');
    await unlink(path);
    await syncDirectory(this.directory);
    this.closed = true;
  }
}

const createLockBody = (): LockBody => ({
  version: 1,
  pid: process.pid,
  hostname: hostname(),
  token: randomUUID(),
  createdAt: new Date().toISOString(),
});

async function writeExclusiveLock(path: string, body: LockBody): Promise<void> {
  const handle = await open(path, 'wx', 0o600);
  try {
    await handle.writeFile(JSON.stringify(body));
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function assertNoReclaimLock(path: string): Promise<void> {
  try {
    await readBoundedFile(path, MAX_LOCK_BYTES);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw new Error('检测到活动或残留的写者锁回收标记，需人工核验后再启动。', { cause: error });
  }
  throw new Error('检测到活动或残留的写者锁回收标记，需人工核验后再启动。');
}

const sameLock = (left: LockBody, right: LockBody): boolean =>
  left.version === right.version &&
  left.pid === right.pid &&
  left.hostname === right.hostname &&
  left.token === right.token &&
  left.createdAt === right.createdAt;

async function releaseReclaimLock(directory: string, path: string, expected: LockBody): Promise<void> {
  const current = parseLock((await readBoundedFile(path, MAX_LOCK_BYTES)).toString('utf8'));
  if (!sameLock(current, expected)) throw new Error('写者锁回收标记身份已改变，拒绝删除。');
  await unlink(path);
  await syncDirectory(directory);
}

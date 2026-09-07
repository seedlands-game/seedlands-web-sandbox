import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeSyncedFile(path: string, data: Uint8Array): Promise<void> {
  const handle = await open(path, 'wx', 0o600);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function writeImmutableFile(root: string, relativePath: string, data: Uint8Array): Promise<void> {
  const target = join(root, relativePath);
  try {
    const existing = await readBoundedFile(target, data.byteLength);
    if (!existing.equals(data)) throw new Error(`不可变文件内容冲突：${relativePath}`);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeSyncedFile(temporary, data);
    await rename(temporary, target);
    await syncDirectory(dirname(target));
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export async function replaceDurableFile(root: string, name: string, data: Uint8Array): Promise<void> {
  const target = join(root, name);
  const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeSyncedFile(temporary, data);
    await rename(temporary, target);
    await syncDirectory(root);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export async function readBoundedFile(path: string, maximumBytes: number): Promise<Buffer> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size < 1 || metadata.size > maximumBytes)
      throw new Error(`文件长度越界或类型无效：${path}`);
    const data = Buffer.allocUnsafe(metadata.size);
    let offset = 0;
    while (offset < data.byteLength) {
      const { bytesRead } = await handle.read(data, offset, data.byteLength - offset, offset);
      if (!bytesRead) throw new Error(`文件读取时被截断：${path}`);
      offset += bytesRead;
    }
    const probe = Buffer.allocUnsafe(1);
    if ((await handle.read(probe, 0, 1, data.byteLength)).bytesRead)
      throw new Error(`文件读取期间长度发生变化：${path}`);
    return data;
  } finally {
    await handle.close();
  }
}

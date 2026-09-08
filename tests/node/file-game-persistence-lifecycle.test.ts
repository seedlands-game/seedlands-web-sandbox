import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as durableFiles from '../../apps/node-server/src/node/persistence/durable-files';
import { FileGamePersistence } from '../../apps/node-server/src/node/persistence/file-game-persistence';
import { GameServer } from '../../packages/game-core/src/server/game-server';
import { GENERATOR_VERSION, Voxel } from '../../packages/game-core/src/world/voxel';
import { testCorePlatform } from '../support/core-platform';

const directories: string[] = [];

async function temporaryWorld(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'seedlands-file-store-lifecycle-'));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const openStore = (directory: string, seedText: string): Promise<FileGamePersistence> =>
  FileGamePersistence.open({ directory, seedText, generatorVersion: GENERATOR_VERSION });

async function save(server: GameServer, commitSequence: number): Promise<void> {
  await server.saveFrozen(server.freezeSaveSnapshot(commitSequence));
}

describe('Node 文件游戏持久化生命周期', () => {
  it('close 禁止新 Chunk 读取并等待已登记读取结束后才释放锁', async () => {
    const directory = await temporaryWorld();
    const initial = await openStore(directory, 'close-load-race');
    const server = new GameServer({ platform: testCorePlatform, seedText: 'close-load-race', persistence: initial });
    server.edit(0, 20, 0, Voxel.Wood);
    await save(server, 1);
    await initial.close();
    const pointer = JSON.parse(await readFile(join(directory, 'CURRENT'), 'utf8')) as { manifest: string };
    const manifest = JSON.parse(await readFile(join(directory, pointer.manifest), 'utf8')) as {
      chunks: Record<string, { path: string }>;
    };
    const chunkPath = join(directory, manifest.chunks['0,0,0'].path);
    const store = await openStore(directory, 'close-load-race');
    const originalRead = durableFiles.readBoundedFile;
    let markReading!: () => void;
    let releaseRead!: () => void;
    const reading = new Promise<void>((resolve) => {
      markReading = resolve;
    });
    const barrier = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    const readSpy = vi.spyOn(durableFiles, 'readBoundedFile').mockImplementation(async (path, maximumBytes) => {
      if (path === chunkPath) {
        markReading();
        await barrier;
      }
      return originalRead(path, maximumBytes);
    });

    const ensuring = store.ensureSnapshot(0, 0, 0);
    await reading;
    const closing = store.close();
    await expect(store.ensureSnapshot(0, 0, 0)).rejects.toThrow(/关闭|closed/i);
    await expect(openStore(directory, 'close-load-race')).rejects.toThrow(/锁|lock|writer/i);
    releaseRead();
    await ensuring;
    await closing;
    readSpy.mockRestore();

    const reopened = await openStore(directory, 'close-load-race');
    await reopened.ensureSnapshot(0, 0, 0);
    expect(reopened.loadSnapshot('0,0,0')?.voxels).toContain(Voxel.Wood);
    await reopened.close();
  });

  it('只保留 CURRENT 与 PREVIOUS 可达的已知存储文件，并在启动时回收崩溃孤儿', async () => {
    const directory = await temporaryWorld();
    const store = await openStore(directory, 'bounded-history');
    const server = new GameServer({ platform: testCorePlatform, seedText: 'bounded-history', persistence: store });
    server.spawnPlayer({ id: 'player', position: [0.5, 34, 0.5] });
    server.edit(0, 20, 0, Voxel.Wood);
    await save(server, 1);
    const firstPointer = JSON.parse(await readFile(join(directory, 'CURRENT'), 'utf8')) as { manifest: string };
    const firstManifest = JSON.parse(await readFile(join(directory, firstPointer.manifest), 'utf8')) as {
      gameplay: { path: string };
      chunks: Record<string, { path: string }>;
    };

    server.updateEntity('player', { position: [1.5, 34, 0.5] });
    server.edit(1, 20, 0, Voxel.Lantern);
    await save(server, 2);
    await expect(readFile(join(directory, firstPointer.manifest))).resolves.toBeTruthy();
    await expect(readFile(join(directory, firstManifest.gameplay.path))).resolves.toBeTruthy();
    await expect(readFile(join(directory, firstManifest.chunks['0,0,0'].path))).resolves.toBeTruthy();

    await writeFile(join(directory, 'blobs', 'user-notes.json'), 'preserve me');
    server.updateEntity('player', { position: [2.5, 34, 0.5] });
    server.edit(2, 20, 0, Voxel.Stone);
    await save(server, 3);
    await expect(readFile(join(directory, firstPointer.manifest))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(join(directory, firstManifest.gameplay.path))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(join(directory, firstManifest.chunks['0,0,0'].path))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(readFile(join(directory, 'blobs', 'user-notes.json'), 'utf8')).resolves.toBe('preserve me');
    await store.close();

    const orphanHash = 'a'.repeat(64);
    const orphanChunk = join(directory, 'blobs', `chunk-${orphanHash}.json`);
    const orphanGameplay = join(directory, 'blobs', `gameplay-${orphanHash}.json`);
    const orphanManifest = join(directory, 'manifests', `manifest-999-${orphanHash}.json`);
    await writeFile(orphanChunk, '{}');
    await writeFile(orphanGameplay, '{}');
    await writeFile(orphanManifest, '{}');

    const reopened = await openStore(directory, 'bounded-history');
    await expect(readFile(orphanChunk)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(orphanGameplay)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(orphanManifest)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(join(directory, 'blobs', 'user-notes.json'), 'utf8')).resolves.toBe('preserve me');
    await reopened.ensureSnapshot(0, 0, 0);
    expect(reopened.loadSnapshot('0,0,0')?.voxels).toContain(Voxel.Stone);
    await reopened.close();
  });

  it('GC 遇到存储子目录符号链接时 fail closed 且不删除目录外文件', async () => {
    const directory = await temporaryWorld();
    const outsideDirectory = await temporaryWorld();
    const initial = await openStore(directory, 'gc-directory-link');
    await initial.close();
    await rm(join(directory, 'blobs'), { recursive: true });
    const knownExternalFile = join(outsideDirectory, `chunk-${'b'.repeat(64)}.json`);
    await writeFile(knownExternalFile, '{}');
    await symlink(outsideDirectory, join(directory, 'blobs'));

    await expect(openStore(directory, 'gc-directory-link')).rejects.toThrow(/子目录类型.*拒绝回收/);
    await expect(readFile(knownExternalFile, 'utf8')).resolves.toBe('{}');
  });
});

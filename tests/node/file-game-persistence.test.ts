import { testCorePlatform } from '../support/core-platform';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GameServer } from '../../packages/game-core/src/server/game-server';
import type { FrozenGameSaveSnapshot } from '../../packages/game-core/src/server/persistence/game-save-snapshot';
import {
  FileGamePersistence,
  type FileGamePersistenceFaultStage,
} from '../../apps/node-server/src/node/persistence/file-game-persistence';
import { FileStoreLock } from '../../apps/node-server/src/node/persistence/file-store-lock';
import { GENERATOR_VERSION, Voxel } from '../../packages/game-core/src/world/voxel';

const directories: string[] = [];

async function temporaryWorld(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'seedlands-file-store-'));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function openStore(
  directory: string,
  seedText = 'file-persistence',
  faultInjector?: (stage: FileGamePersistenceFaultStage) => void,
): Promise<FileGamePersistence> {
  return FileGamePersistence.open({ directory, seedText, generatorVersion: GENERATOR_VERSION, faultInjector });
}

async function save(server: GameServer, commitSequence: number): Promise<FrozenGameSaveSnapshot> {
  const snapshot = server.freezeSaveSnapshot(commitSequence);
  await server.saveFrozen(snapshot);
  return snapshot;
}

describe('Node 文件游戏持久化', () => {
  it('close 启动后立即拒绝新保存，等待已接纳写入完成才释放锁', async () => {
    const directory = await temporaryWorld();
    const store = await openStore(directory, 'close-race');
    const server = new GameServer({ platform: testCorePlatform, seedText: 'close-race' });
    server.edit(0, 20, 0, Voxel.Wood);
    const firstSnapshot = server.freezeSaveSnapshot(1);
    let release!: () => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const internal = store as unknown as {
      publish(snapshot: FrozenGameSaveSnapshot): Promise<void>;
    };
    const publish = internal.publish.bind(store);
    internal.publish = async (snapshot) => {
      markStarted();
      await barrier;
      await publish(snapshot);
    };

    const firstSave = store.saveFrozenSnapshot(firstSnapshot);
    await started;
    const closing = store.close();
    expect(() => store.saveFrozenSnapshot(firstSnapshot)).toThrow(/关闭|closed/i);
    await expect(openStore(directory, 'close-race')).rejects.toThrow(/锁|lock|writer/i);
    release();
    await firstSave;
    await closing;

    const reopened = await openStore(directory, 'close-race');
    expect(reopened.loadGameCheckpoint()).toEqual({ commitSequence: 1, worldRevision: 1 });
    await reopened.close();
  });

  it('重启后异步准备 Chunk，并同步读取同一检查点的 Gameplay 与 checkpoint', async () => {
    const directory = await temporaryWorld();
    const store = await openStore(directory);
    const server = new GameServer({ platform: testCorePlatform, seedText: 'file-persistence', persistence: store });
    server.spawnPlayer({ id: 'player', position: [0.5, 34, 0.5] });
    server.edit(0, 20, 0, Voxel.Water);
    await save(server, 11);
    await store.close();

    const reopened = await openStore(directory);
    expect(reopened.loadSnapshot('0,0,0')).toBeNull();
    expect(reopened.preparedSnapshotStatus('0,0,0')).toBe('unknown');
    await reopened.ensureSnapshot(0, 0, 0);
    expect(reopened.loadSnapshot('0,0,0')).toMatchObject({ key: '0,0,0', revision: 1 });
    expect(reopened.preparedSnapshotStatus('0,0,0')).toBe('found');
    expect(reopened.loadGameplaySnapshot()).toMatchObject({ version: 3, revision: 1 });
    expect(reopened.loadGameCheckpoint()).toEqual({ commitSequence: 11, worldRevision: 1 });

    const restored = new GameServer({
      platform: testCorePlatform,
      seedText: 'file-persistence',
      persistence: reopened,
    });
    await restored.restore();
    await reopened.ensureSnapshot(0, 0, 0);
    expect(restored.getVoxel(0, 20, 0)).toBe(Voxel.Water);
    expect(restored.getEntity('player')?.position).toEqual([0.5, 34, 0.5]);
    await reopened.close();
  });

  it('neighborhood 诊断区分实测文件读取/解码与不适用阶段', async () => {
    const directory = await temporaryWorld();
    const store = await openStore(directory, 'file-timing');
    const server = new GameServer({ platform: testCorePlatform, seedText: 'file-timing', persistence: store });
    server.edit(0, 20, 0, Voxel.Wood);
    await save(server, 1);
    await store.close();

    const reopened = await openStore(directory, 'file-timing');
    const diagnostics = await reopened.ensureNeighborhood(0, 0, 0);
    expect(diagnostics.measurementStatus).toEqual({
      queueWaitMs: 'measured',
      databaseMs: 'unsupported',
      transactionReadMs: 'measured',
      decodeMs: 'measured',
      totalWorkerMs: 'measured',
    });
    expect(diagnostics.transactionReadMs).toBeGreaterThan(0);
    expect(diagnostics.decodeMs).toBeGreaterThanOrEqual(0);
    expect(diagnostics.totalWorkerMs).toBeGreaterThanOrEqual(0);
    await reopened.close();
  });

  it('第二次增量保存复制完整索引，保留未再次冻结的旧 Chunk', async () => {
    const directory = await temporaryWorld();
    const store = await openStore(directory, 'incremental-index');
    const server = new GameServer({ platform: testCorePlatform, seedText: 'incremental-index', persistence: store });
    server.edit(0, 20, 0, Voxel.Wood);
    await save(server, 1);
    server.edit(33, 20, 0, Voxel.Lantern);
    const second = await save(server, 2);
    expect(second.chunks.map((chunk) => chunk.key)).toEqual(['1,0,0']);
    await store.close();

    const reopened = await openStore(directory, 'incremental-index');
    await reopened.ensureNeighborhood(0, 0, 0);
    expect(reopened.loadSnapshot('0,0,0')?.voxels).toContain(Voxel.Wood);
    expect(reopened.loadSnapshot('1,0,0')?.voxels).toContain(Voxel.Lantern);
    expect(reopened.loadGameCheckpoint()).toEqual({ commitSequence: 2, worldRevision: 2 });
    await reopened.close();
  });

  it('同一 commitSequence 只接受完全相同的幂等重试', async () => {
    const directory = await temporaryWorld();
    const store = await openStore(directory, 'checkpoint-identity');
    const server = new GameServer({ platform: testCorePlatform, seedText: 'checkpoint-identity', persistence: store });
    server.edit(0, 20, 0, Voxel.Wood);
    await save(server, 7);
    await expect(save(server, 7)).resolves.toMatchObject({ commitSequence: 7, worldRevision: 1 });

    server.edit(0, 20, 0, Voxel.Lantern);
    await expect(save(server, 7)).rejects.toThrow(/同一 commitSequence.*幂等/);
    await store.close();

    const reopened = await openStore(directory, 'checkpoint-identity');
    expect(reopened.loadGameCheckpoint()).toEqual({ commitSequence: 7, worldRevision: 1 });
    await reopened.ensureSnapshot(0, 0, 0);
    expect(reopened.loadSnapshot('0,0,0')?.voxels).toContain(Voxel.Wood);
    expect(reopened.loadSnapshot('0,0,0')?.voxels).not.toContain(Voxel.Lantern);
    await reopened.close();
  });

  it('同目录只允许一个写者，关闭后才释放锁', async () => {
    const directory = await temporaryWorld();
    const first = await openStore(directory, 'lock-world');
    await expect(openStore(directory, 'lock-world')).rejects.toThrow(/锁|lock|writer/i);
    await first.close();
    const replacement = await openStore(directory, 'lock-world');
    await replacement.close();
  });

  it('拒绝旧的分步保存入口，正式写入只能提交冻结快照', async () => {
    const directory = await temporaryWorld();
    const store = await openStore(directory, 'atomic-only');
    expect(() => store.saveSnapshots([])).toThrow(/冻结|frozen|atomic/i);
    expect(() => store.saveGameplaySnapshot({} as never)).toThrow(/冻结|frozen|atomic/i);
    await store.close();
  });

  it.each<FileGamePersistenceFaultStage>([
    'after-chunk-blobs',
    'after-gameplay-blob',
    'after-manifest',
    'after-previous-pointer',
    'before-current-pointer',
    'after-current-pointer',
  ])('在 %s 故障后重启只读取完整旧或完整新检查点', async (failureStage) => {
    const directory = await temporaryWorld();
    let injected: FileGamePersistenceFaultStage | null = null;
    const store = await openStore(directory, 'fault-world', (stage) => {
      if (stage === injected) throw new Error(`injected ${stage}`);
    });
    const server = new GameServer({ platform: testCorePlatform, seedText: 'fault-world', persistence: store });
    server.edit(0, 20, 0, Voxel.Wood);
    await save(server, 1);
    server.edit(33, 20, 0, Voxel.Lantern);
    injected = failureStage;
    await expect(save(server, 2)).rejects.toThrow(`injected ${failureStage}`);
    await store.close();

    const reopened = await openStore(directory, 'fault-world');
    const checkpoint = reopened.loadGameCheckpoint();
    expect([1, 2]).toContain(checkpoint?.commitSequence);
    await reopened.ensureSnapshot(0, 0, 0);
    expect(reopened.loadSnapshot('0,0,0')?.voxels).toContain(Voxel.Wood);
    await reopened.ensureSnapshot(1, 0, 0);
    expect(reopened.preparedSnapshotStatus('1,0,0')).toBe(checkpoint?.commitSequence === 2 ? 'found' : 'missing');
    await reopened.close();
  });

  it('排队前复制冻结体，调用方随后修改 token 不会改变落盘内容', async () => {
    const directory = await temporaryWorld();
    const store = await openStore(directory, 'frozen-copy');
    const server = new GameServer({ platform: testCorePlatform, seedText: 'frozen-copy' });
    server.spawnPlayer({ id: 'player', position: [0.5, 34, 0.5] });
    server.edit(0, 20, 0, Voxel.Wood);
    const frozen = server.freezeSaveSnapshot(1);
    const saving = store.saveFrozenSnapshot(frozen);
    const mutable = frozen as unknown as {
      gameplay: { entities: Array<{ position: [number, number, number] }> };
      chunks: Array<{ voxels: Uint16Array }>;
    };
    mutable.gameplay.entities[0].position[1] = 999;
    mutable.chunks[0].voxels.fill(Voxel.Lantern);
    await saving;
    await store.close();

    const reopened = await openStore(directory, 'frozen-copy');
    await reopened.ensureSnapshot(0, 0, 0);
    expect(reopened.loadGameplaySnapshot()).toMatchObject({ entities: [{ position: [0.5, 34, 0.5] }] });
    expect(reopened.loadSnapshot('0,0,0')?.voxels).toContain(Voxel.Wood);
    await reopened.close();
  });

  it('无法核验的损坏锁 fail closed；已确认不存在的本机 PID 锁可回收', async () => {
    const directory = await temporaryWorld();
    await writeFile(join(directory, 'LOCK'), 'not-json');
    await expect(openStore(directory, 'lock-validation')).rejects.toThrow(/锁.*损坏|lock/i);
    expect(await readFile(join(directory, 'LOCK'), 'utf8')).toBe('not-json');

    await writeFile(
      join(directory, 'LOCK'),
      JSON.stringify({
        version: 1,
        pid: 2_147_483_647,
        hostname: hostname(),
        token: 'stale-token',
        createdAt: new Date(0).toISOString(),
      }),
    );
    const recovered = await openStore(directory, 'lock-validation');
    await recovered.close();
  });

  it('两个打开者都观察到同一过期锁时只有独占回收者能启动', async () => {
    const directory = await temporaryWorld();
    await writeFile(
      join(directory, 'LOCK'),
      JSON.stringify({
        version: 1,
        pid: 2_147_483_647,
        hostname: hostname(),
        token: 'shared-stale-token',
        createdAt: new Date(0).toISOString(),
      }),
    );
    let observed = 0;
    let releaseObservers!: () => void;
    const observersReady = new Promise<void>((resolve) => {
      releaseObservers = resolve;
    });
    const afterStaleObserved = async () => {
      observed += 1;
      if (observed === 2) releaseObservers();
      await observersReady;
    };

    const results = await Promise.allSettled([
      FileStoreLock.acquire(directory, { afterStaleObserved }),
      FileStoreLock.acquire(directory, { afterStaleObserved }),
    ]);
    expect(observed).toBe(2);
    const winners = results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
    const losers = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0]).toBeInstanceOf(Error);
    expect((losers[0] as Error).message).toMatch(/回收|竞争/);
    await winners[0].release();
  });

  it('写者锁回收标记残留时 fail closed，不递归自动抢占', async () => {
    const directory = await temporaryWorld();
    await writeFile(
      join(directory, 'LOCK-RECLAIM'),
      JSON.stringify({
        version: 1,
        pid: 2_147_483_647,
        hostname: hostname(),
        token: 'abandoned-reclaim-token',
        createdAt: new Date(0).toISOString(),
      }),
    );
    await expect(openStore(directory, 'reclaim-fail-closed')).rejects.toThrow(/回收标记.*人工核验/);
    expect(await readFile(join(directory, 'LOCK-RECLAIM'), 'utf8')).toContain('abandoned-reclaim-token');
  });

  it('Gameplay 超过配置上限时拒绝发布并保持 CURRENT 不存在', async () => {
    const directory = await temporaryWorld();
    const store = await FileGamePersistence.open({
      directory,
      seedText: 'bounded-store',
      generatorVersion: GENERATOR_VERSION,
      limits: { maxGameplayBytes: 16 },
    });
    const server = new GameServer({ platform: testCorePlatform, seedText: 'bounded-store', persistence: store });
    server.edit(0, 20, 0, Voxel.Wood);
    await expect(save(server, 1)).rejects.toThrow(/Gameplay.*上限/i);
    await store.close();
    await expect(readFile(join(directory, 'CURRENT'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('CURRENT 引用损坏时 fail closed，保留文件且不静默回滚', async () => {
    const directory = await temporaryWorld();
    const store = await openStore(directory, 'corrupt-world');
    const server = new GameServer({ platform: testCorePlatform, seedText: 'corrupt-world', persistence: store });
    server.edit(0, 20, 0, Voxel.Wood);
    await save(server, 1);
    server.edit(33, 20, 0, Voxel.Lantern);
    await save(server, 2);
    await store.close();

    const pointerPath = join(directory, 'CURRENT');
    const pointer = JSON.parse(await readFile(pointerPath, 'utf8')) as { manifest: string };
    const manifestPath = join(directory, pointer.manifest);
    const before = await readFile(manifestPath);
    await writeFile(manifestPath, Buffer.concat([before, Buffer.from('\ncorrupt')]));
    await expect(openStore(directory, 'corrupt-world')).rejects.toThrow(/损坏|hash|length|manifest/i);
    expect(await readFile(manifestPath)).toEqual(Buffer.concat([before, Buffer.from('\ncorrupt')]));

    const previous = await FileGamePersistence.inspectPreviousCheckpoint({
      directory,
      seedText: 'corrupt-world',
      generatorVersion: GENERATOR_VERSION,
    });
    expect(previous).toMatchObject({ checkpoint: { commitSequence: 1 } });
  });

  it('启动校验后 Chunk 被换成目录外符号链接时也拒绝跟随', async () => {
    const directory = await temporaryWorld();
    const outsideDirectory = await temporaryWorld();
    const store = await openStore(directory, 'symlink-swap');
    const server = new GameServer({ platform: testCorePlatform, seedText: 'symlink-swap', persistence: store });
    server.edit(0, 20, 0, Voxel.Wood);
    await save(server, 1);
    await store.close();

    const reopened = await openStore(directory, 'symlink-swap');
    const pointer = JSON.parse(await readFile(join(directory, 'CURRENT'), 'utf8')) as { manifest: string };
    const manifest = JSON.parse(await readFile(join(directory, pointer.manifest), 'utf8')) as {
      chunks: Record<string, { path: string }>;
    };
    const chunkPath = join(directory, manifest.chunks['0,0,0'].path);
    const outsidePath = join(outsideDirectory, 'outside-chunk.json');
    await rename(chunkPath, outsidePath);
    await symlink(outsidePath, chunkPath);

    await expect(reopened.ensureSnapshot(0, 0, 0)).rejects.toMatchObject({ code: 'ELOOP' });
    expect(reopened.preparedSnapshotStatus('0,0,0')).toBe('unknown');
    expect(await readFile(outsidePath)).toEqual(await readFile(chunkPath));
    await reopened.close();
  });

  it('内容 hash 损坏、世界身份不匹配和越界 manifest 都拒绝启动', async () => {
    const directory = await temporaryWorld();
    const store = await openStore(directory, 'validation-world');
    const server = new GameServer({ platform: testCorePlatform, seedText: 'validation-world', persistence: store });
    server.edit(0, 20, 0, Voxel.Wood);
    await save(server, 1);
    await store.close();

    await expect(openStore(directory, 'another-seed')).rejects.toThrow(/seed|世界身份/i);
    const pointer = JSON.parse(await readFile(join(directory, 'CURRENT'), 'utf8')) as { manifest: string };
    const manifest = JSON.parse(await readFile(join(directory, pointer.manifest), 'utf8')) as {
      chunks: Record<string, { path: string }>;
    };
    const chunkPath = join(directory, manifest.chunks['0,0,0'].path);
    const chunk = await readFile(chunkPath);
    chunk[chunk.length - 1] ^= 0xff;
    await writeFile(chunkPath, chunk);
    await expect(openStore(directory, 'validation-world')).rejects.toThrow(/hash|损坏/i);

    expect(
      createHash('sha256')
        .update(await readFile(join(directory, pointer.manifest)))
        .digest('hex'),
    ).toHaveLength(64);
  });
});

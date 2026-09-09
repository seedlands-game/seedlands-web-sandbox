import { testCorePlatform } from '../support/core-platform';
import { describe, expect, it } from 'vitest';
import { AuthorityRuntime } from '../../packages/game-core/src/server/authority/authority-runtime';
import { MemoryGamePersistence } from '../../packages/game-core/src/server/persistence/memory-game-persistence';
import { PROTOCOL_VERSION } from '../../packages/game-core/src/runtime/session-protocol';
import { CHUNK_SIZE, Voxel, chunkKey, voxelIndex } from '../../packages/game-core/src/world/voxel';
import { bodyConfigFor, bodyWorldAabb } from '../../packages/game-core/src/physics';
import type { ChunkPersistenceLoadDiagnostics } from '../../packages/game-core/src/server/persistence/chunk-persistence';
import { CanonicalChunkResidencyPressureError } from '../../packages/game-core/src/server/chunk-residency';

describe('AuthorityRuntime', () => {
  it('bootstrap 完成后重锚启动时钟，首次 wake 不补算加载耗时', async () => {
    let nowMs = 100;
    const persistence = Object.assign(new MemoryGamePersistence({ clone: testCorePlatform.clone }), {
      loadGameCheckpoint: async () => {
        nowMs = 5_100;
        return null;
      },
    });
    const runtime = await AuthorityRuntime.create({
      platform: { ...testCorePlatform, now: () => nowMs },
      epoch: 'world:bootstrap-clock',
      seedText: 'authority-bootstrap-clock',
      persistence,
      initialWorldTime: 9,
      startTimeMs: 0,
      startClock: () => nowMs,
      initialPlayerBodyPosition: [0.5, 33, 0.5],
    });

    expect(runtime.ready().snapshot.physicsTick).toBe(0);
    nowMs += 20;
    expect(runtime.wake(nowMs).physicsTick).toBe(1);
  });

  it('ready 在宿主 tick 与暂停推进后只读当前快照，不重新采样启动时刻', async () => {
    const runtime = await AuthorityRuntime.create({
      platform: testCorePlatform,
      epoch: 'world:ready-after-tick',
      seedText: 'ready-after-tick',
      initialWorldTime: 9,
      startTimeMs: 100,
      initialPlayerBodyPosition: [0.5, 33, 0.5],
    });
    runtime.wake(120);
    const running = runtime.snapshot();
    expect(runtime.ready().snapshot).toMatchObject(running);
    runtime.pause(125);
    const observation = runtime.createLogicObservation();
    runtime.advancePausedSession(100);
    const paused = runtime.snapshot();
    expect(runtime.ready().snapshot).toMatchObject(paused);
    expect(
      runtime.receiveLogicIntentBatch({
        protocolVersion: 1,
        epoch: observation.epoch,
        observationSequence: observation.observationSequence,
        expiresAtPhysicsTick: observation.physicsTick + 1,
        intents: [],
      }),
    ).toBe(false);
    expect(runtime.sessionTimeMs).toBe(125);
    expect(runtime.snapshot()).toEqual(paused);
  });

  it('把单次有界持久化加载分项附在对应Mesh准备回执上', async () => {
    const persistence = Object.assign(new MemoryGamePersistence({ clone: testCorePlatform.clone }), {
      ensureNeighborhood: async (): Promise<ChunkPersistenceLoadDiagnostics> => ({
        requestedKeyCount: 27,
        foundCount: 0,
        missingCount: 27,
        queueWaitMs: 2,
        databaseMs: 1,
        transactionReadMs: 4,
        decodeMs: 0,
        totalWorkerMs: 8,
        codecs: {},
      }),
    });
    const runtime = await AuthorityRuntime.create({
      platform: { ...testCorePlatform, now: () => 1 },
      epoch: 'world:prepare-diagnostics',
      seedText: 'authority-prepare-diagnostics',
      persistence,
      initialWorldTime: 9,
      startTimeMs: 0,
      initialPlayerBodyPosition: [0.5, 33, 0.5],
    });

    const prepared = await runtime.prepareMesh(0, 1, -2);

    expect(prepared.preparationDiagnostics).toMatchObject({
      authorityPrepareMs: expect.any(Number),
      persistenceWaitMs: expect.any(Number),
      snapshotCopyMs: expect.any(Number),
      persistence: { requestedKeyCount: 27, foundCount: 0, missingCount: 27 },
    });
  });

  it('Mesh准备异常时释放完整读集pin且显式release后不残留中心pin', async () => {
    const persistence = Object.assign(new MemoryGamePersistence({ clone: testCorePlatform.clone }), {
      ensureNeighborhood: async () => {
        throw new Error('load failed');
      },
    });
    const runtime = await AuthorityRuntime.create({
      platform: testCorePlatform,
      epoch: 'world:prepare-release-on-error',
      seedText: 'authority-prepare-release-on-error',
      persistence,
      initialWorldTime: 9,
      startTimeMs: 0,
      initialPlayerBodyPosition: [0.5, 33, 0.5],
      canonicalResidency: { target: 0, hardLimit: 64, evictionBatch: 64 },
    });
    const key = chunkKey(0, 0, 0);
    runtime.server.setFluidActiveChunks([key]);
    expect(
      runtime.acceptGeneratedChunk({
        key,
        cx: 0,
        cy: 0,
        cz: 0,
        chunkRevision: 0,
        generatorVersion: runtime.server.generatorVersion,
        canonical: new Uint16Array(CHUNK_SIZE ** 3),
      }),
    ).toBe(true);
    runtime.server.setFluidActiveChunks([]);

    await expect(runtime.prepareMesh(0, 0, 0)).rejects.toThrow('load failed');
    runtime.releaseMesh(0, 0, 0);

    expect(runtime.server.canonicalResidencyDiagnostics).toMatchObject({ residentCount: 0, pinnedCount: 0 });
  });

  it('Mesh专用读取在持久overlay无法入驻时fail closed并可在压力解除后重试', async () => {
    const seedText = 'authority-mesh-pressure';
    const persistence = new MemoryGamePersistence({ clone: testCorePlatform.clone });
    const overlayKey = chunkKey(1, 2, 1);
    persistence.saveSnapshots([
      {
        key: overlayKey,
        cx: 1,
        cy: 2,
        cz: 1,
        seedText,
        generatorVersion: 3,
        revision: 7,
        voxels: new Uint16Array(CHUNK_SIZE ** 3).fill(Voxel.Stone),
      },
    ]);
    const runtime = await AuthorityRuntime.create({
      platform: testCorePlatform,
      epoch: 'world:mesh-pressure',
      seedText,
      persistence,
      initialWorldTime: 9,
      startTimeMs: 0,
      initialPlayerBodyPosition: [0.5, 33, 0.5],
      canonicalResidency: { target: 1, hardLimit: 2, evictionBatch: 2 },
    });
    const centerKey = chunkKey(0, 1, 0);
    const pressureKey = chunkKey(4, 0, 0);
    runtime.server.setFluidActiveChunks([centerKey, pressureKey]);
    for (const [key, cx] of [
      [centerKey, 0],
      [pressureKey, 4],
    ] as const)
      expect(
        runtime.acceptGeneratedChunk({
          key,
          cx,
          cy: key === centerKey ? 1 : 0,
          cz: 0,
          chunkRevision: 0,
          generatorVersion: runtime.server.generatorVersion,
          canonical: new Uint16Array(CHUNK_SIZE ** 3),
        }),
      ).toBe(true);

    await expect(runtime.prepareMesh(0, 1, 0)).rejects.toEqual(new CanonicalChunkResidencyPressureError(overlayKey));
    runtime.releaseMesh(0, 1, 0);
    runtime.server.setFluidActiveChunks([centerKey]);
    runtime.server.maintainCanonicalResidency();

    const retried = await runtime.prepareMesh(0, 1, 0);
    expect(retried.overlays).toEqual(
      expect.arrayContaining([expect.objectContaining({ cx: 1, cy: 2, cz: 1, voxels: expect.any(ArrayBuffer) })]),
    );
    runtime.releaseMesh(0, 1, 0);
  });

  it('在唯一GameServer内恢复/创建脚底中心玩家并驱动120Hz权威物理', async () => {
    const runtime = await AuthorityRuntime.create({
      platform: testCorePlatform,
      epoch: 'world:1',
      seedText: 'authority-runtime',
      persistence: new MemoryGamePersistence({ clone: testCorePlatform.clone }),
      initialWorldTime: 9,
      startTimeMs: 0,
      initialPlayerBodyPosition: [0.5, 33, 0.5],
    });
    const ready = runtime.ready();
    expect(ready.playerBodyPosition[1] % 1).toBe(0);
    expect(ready.snapshot.player.body.position.y).toBe(ready.playerBodyPosition[1]);
    const prepared = await runtime.prepareMesh(0, 1, 0);
    const canonical = new Uint16Array(32 ** 3);
    canonical[0] = 3;
    expect(runtime.acceptGeneratedChunk({ ...prepared, canonical })).toBe(true);

    runtime.receiveInput({
      kind: 'input',
      protocolVersion: PROTOCOL_VERSION,
      epoch: 'world:1',
      stream: 'player-input',
      sequence: 0,
      targetPhysicsTick: 1,
      issuedAtMs: 0,
      state: { moveX: 0, moveZ: -1, verticalIntent: 0, jumpHeld: false },
      edges: { jumpPressed: false },
    });
    const snapshot = runtime.wake(100);

    expect(snapshot.physicsTick).toBeGreaterThan(0);
    expect(snapshot.player.body.position.z).toBeLessThan(ready.playerBodyPosition[2]);
    expect(runtime.view().entities.find((entity) => entity.id === ready.playerId)?.position).toEqual([
      snapshot.player.body.position.x,
      snapshot.player.body.position.y,
      snapshot.player.body.position.z,
    ]);
  });

  it('只返回Worker生成输入并在显式接纳后建立权威碰撞副本', async () => {
    const runtime = await AuthorityRuntime.create({
      platform: testCorePlatform,
      epoch: 'world:2',
      seedText: 'authority-mesh',
      persistence: new MemoryGamePersistence({ clone: testCorePlatform.clone }),
      initialWorldTime: 9,
      startTimeMs: 0,
      initialPlayerBodyPosition: [0.5, 33, 0.5],
    });

    const first = await runtime.prepareMesh(0, 0, 0);
    const second = await runtime.prepareMesh(0, 0, 0);

    expect(first.canonical).toBeUndefined();
    expect(first.overlays).toEqual([]);
    expect(second.canonical).toBeUndefined();
    expect(runtime.server.peekLoadedVoxel(0, 0, 0)).toBeNull();

    const canonical = new Uint16Array(32 ** 3);
    canonical[0] = 3;
    expect(runtime.acceptGeneratedChunk({ ...first, canonical })).toBe(true);
    expect(runtime.server.peekLoadedVoxel(0, 0, 0)?.voxel).toBe(3);
  });

  it('按epoch+issuer+stream+sequence复用事务回执并拒绝过期提交视图', async () => {
    const runtime = await AuthorityRuntime.create({
      platform: testCorePlatform,
      epoch: 'world:3',
      seedText: 'authority-transactions',
      persistence: new MemoryGamePersistence({ clone: testCorePlatform.clone }),
      initialWorldTime: 9,
      startTimeMs: 0,
      initialPlayerBodyPosition: [0.5, 33, 0.5],
    });
    let executions = 0;
    const identity = { epoch: 'world:3', issuer: 'browser', stream: 'actions', sequence: 1 };
    const first = await runtime.executeTransaction(identity, async () => ({ executions: ++executions }));
    const duplicate = await runtime.executeTransaction(identity, async () => ({ executions: ++executions }));
    expect(duplicate).toBe(first);
    expect(executions).toBe(1);

    const conflict = await runtime.executeTransaction(
      { ...identity, sequence: 2, expectedCommitSequence: first.commitSequence - 1 },
      async () => ({ executions: ++executions }),
    );
    expect(conflict).toMatchObject({ status: 'conflict', commitSequence: first.commitSequence });
    expect(executions).toBe(1);
  });

  it('结构提交包围身体时在下一权威物理步经统一恢复队列移出固体', async () => {
    const runtime = await AuthorityRuntime.create({
      platform: testCorePlatform,
      epoch: 'world:geometry-recovery',
      seedText: 'authority-geometry-recovery',
      persistence: new MemoryGamePersistence({ clone: testCorePlatform.clone }),
      initialWorldTime: 9,
      startTimeMs: 0,
      initialPlayerBodyPosition: [16.5, 1, 16.5],
    });
    const prepared = await runtime.prepareMesh(0, 0, 0);
    const canonical = new Uint16Array(CHUNK_SIZE ** 3);
    for (let z = 0; z < CHUNK_SIZE; z += 1)
      for (let x = 0; x < CHUNK_SIZE; x += 1) canonical[voxelIndex(x, 0, z)] = Voxel.Stone;
    expect(runtime.acceptGeneratedChunk({ ...prepared, canonical })).toBe(true);
    runtime.ready();
    runtime.wake(1_000 / 60);

    const commit = await runtime.editWorld('geometry-recovery-test', [{ x: 16, y: 1, z: 16, value: Voxel.Stone }]);
    expect(commit.committed).toBe(true);
    const recovered = runtime.wake(2_000 / 60);
    const bounds = bodyWorldAabb(recovered.player.body, bodyConfigFor('player'));
    const overlapsInsertedBlock =
      bounds.max.x > 16 &&
      bounds.min.x < 17 &&
      bounds.max.y > 1 &&
      bounds.min.y < 2 &&
      bounds.max.z > 16 &&
      bounds.min.z < 17;

    expect(overlapsInsertedBlock).toBe(false);
    expect(recovered.diagnostics?.recoveryResults.at(-1)).toMatchObject({
      entityId: runtime.playerId,
      reason: 'external-geometry-change',
      status: 'recovered',
    });
    const recoveryCount = recovered.diagnostics?.recoveryResults.length;
    await runtime.editWorld('geometry-recovery-test', [{ x: 24, y: 1, z: 24, value: Voxel.Stone }]);
    expect(runtime.wake(3_000 / 60).diagnostics?.recoveryResults).toHaveLength(recoveryCount ?? 0);

    runtime.setPlayerPosition([8.5, 1, 8.5]);
    await runtime.editWorld('geometry-recovery-test', [{ x: 8, y: 1, z: 8, value: Voxel.Water }]);
    expect(runtime.wake(4_000 / 60).diagnostics?.recoveryResults).toHaveLength(recoveryCount ?? 0);
  });
});

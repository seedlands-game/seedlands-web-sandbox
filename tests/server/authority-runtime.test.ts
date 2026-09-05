import { describe, expect, it } from 'vitest';
import { AuthorityRuntime } from '../../src/server/authority/authority-runtime';
import { MemoryGamePersistence } from '../../src/server/persistence/memory-game-persistence';
import { PROTOCOL_VERSION } from '../../src/runtime/session-protocol';

describe('AuthorityRuntime', () => {
  it('在唯一GameServer内恢复/创建脚底中心玩家并驱动120Hz权威物理', async () => {
    const runtime = await AuthorityRuntime.create({
      epoch: 'world:1',
      seedText: 'authority-runtime',
      persistence: new MemoryGamePersistence(),
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
      epoch: 'world:2',
      seedText: 'authority-mesh',
      persistence: new MemoryGamePersistence(),
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
      epoch: 'world:3',
      seedText: 'authority-transactions',
      persistence: new MemoryGamePersistence(),
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
});

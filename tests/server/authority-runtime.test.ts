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
    });
    const ready = runtime.ready();
    expect(ready.playerBodyPosition[1] % 1).toBe(0);
    expect(ready.snapshot.player.body.position.y).toBe(ready.playerBodyPosition[1]);

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

  it('异步准备网格后返回可传输副本且不分离权威Chunk存储', async () => {
    const runtime = await AuthorityRuntime.create({
      epoch: 'world:2',
      seedText: 'authority-mesh',
      persistence: new MemoryGamePersistence(),
      initialWorldTime: 9,
      startTimeMs: 0,
    });

    const first = await runtime.prepareMesh(0, 0, 0);
    const second = await runtime.prepareMesh(0, 0, 0);

    expect(first.canonical).not.toBe(second.canonical);
    expect(first.canonical.byteLength).toBe(32 ** 3 * Uint16Array.BYTES_PER_ELEMENT);
    expect(first.fluid.byteLength).toBe(32 ** 3 * Uint8Array.BYTES_PER_ELEMENT);
    expect(first.haloRevision).toBe(second.haloRevision);
  });
});

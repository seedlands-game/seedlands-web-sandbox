import { testCorePlatform } from '../support/core-platform';
import { describe, expect, it } from 'vitest';
import { AuthorityRuntime } from '../../packages/game-core/src/server/authority/authority-runtime';
import { GameServer } from '../../packages/game-core/src/server/game-server';
import type { WorkerCanonicalResult } from '../../packages/game-core/src/server/game-server-types';
import { MemoryGamePersistence } from '../../packages/game-core/src/server/persistence/memory-game-persistence';
import { runWorldComputeTask } from '../../packages/game-core/src/compute/world-compute-task';

type StarterBootstrap = Readonly<{
  kind: 'safe-spawn-result';
  playerBodyPosition: [number, number, number];
  starterChunks: readonly (Omit<WorkerCanonicalResult, 'canonical'> & { canonical: ArrayBuffer })[];
}>;

describe('Authority新世界生态bootstrap', () => {
  it('由General计算完整近场后在ready前恢复营地、三类角色和食物', async () => {
    let computed: StarterBootstrap | null = null;
    const runtime = await AuthorityRuntime.create({
      platform: testCorePlatform,
      epoch: 'starter:1',
      seedText: 'starter-authority',
      persistence: new MemoryGamePersistence({ clone: testCorePlatform.clone }),
      initialWorldTime: 9,
      startTimeMs: 0,
      findInitialWorldBootstrap: async (seed: number, generatorVersion: number) => {
        computed = (await runWorldComputeTask({
          kind: 'find-safe-spawn',
          seed,
          generatorVersion,
        })) as unknown as StarterBootstrap;
        return {
          playerBodyPosition: computed.playerBodyPosition,
          starterChunks: computed.starterChunks.map((chunk) => ({
            ...chunk,
            canonical: new Uint16Array(chunk.canonical),
          })),
        };
      },
    } as unknown as Parameters<typeof AuthorityRuntime.create>[0]);

    expect(computed).toMatchObject({ kind: 'safe-spawn-result' });
    expect(computed!.starterChunks.length).toBeGreaterThan(0);
    const ready = runtime.ready();
    expect(ready.campPosition).toBeDefined();
    expect(
      runtime
        .view()
        .actors.map((actor) => actor.archetype)
        .sort(),
    ).toEqual(['grazer', 'night-stalker', 'settler']);
    expect(runtime.view().entities).toContainEqual(
      expect.objectContaining({ type: 'world-item', stack: { itemId: 'berry', count: 1 } }),
    );
  });

  it('loaded-only初始化在近场不完整时失败且不生成未知Chunk', () => {
    const server = new GameServer({ platform: testCorePlatform, seedText: 'starter-loaded-only' });
    const initialize = (
      server as unknown as {
        initializeStarterEcologyFromLoadedWorld: (center: [number, number, number]) => unknown;
      }
    ).initializeStarterEcologyFromLoadedWorld;

    expect(initialize).toBeTypeOf('function');
    expect(() => initialize.call(server, [0.5, 33, 0.5])).toThrow(/loaded/i);
    expect(server.peekLoadedVoxel(0, 0, 0)).toBeNull();
  });
});

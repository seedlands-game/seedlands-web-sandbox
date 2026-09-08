import { describe, expect, it } from 'vitest';
import type { BodyConfig } from '../../packages/game-core/src/physics';
import {
  AuthoritySession,
  type AuthorityServerPort,
} from '../../packages/game-core/src/server/authority/authority-session';
import { Voxel } from '../../packages/game-core/src/world/voxel';

type Entity = ReturnType<AuthorityServerPort['queryEntities']>[number];

const bodyConfig: BodyConfig = {
  localAabb: { min: { x: -0.3, y: 0, z: -0.3 }, max: { x: 0.3, y: 1.8, z: 0.3 } },
  gravity: 20,
};

describe('Authority世界时钟', () => {
  it('动态控制独立世界时钟速率并拒绝非法速率', () => {
    let worldTime = 8;
    const entity: Entity = { id: 'player-1', type: 'player', position: [0.5, 0, 0.5] };
    const server: AuthorityServerPort = {
      worldRevision: 0,
      mutationCount: 0,
      get worldTime() {
        return worldTime;
      },
      getEntity: (id) => (id === entity.id ? entity : null),
      queryEntities: () => [entity],
      updateEntity: () => undefined,
      advanceGameplayRules: () => undefined,
      advanceWorldClock: (hours) => {
        worldTime += hours;
      },
    };
    const session = new AuthoritySession({
      epoch: 'test-world:1',
      playerId: entity.id,
      server,
      bodyConfigFor: () => bodyConfig,
      voxelSource: {
        getLoadedVoxel: (_x, y) => ({ voxel: y === -1 ? Voxel.Stone : Voxel.Air, chunkKey: 'loaded', revision: 0 }),
      },
      frequencies: { physicsHz: 60, gameplayHz: 20, fluidHz: 30 },
      startTimeMs: 0,
    });

    session.setWorldClockRate(0);
    session.wake(50);
    expect(worldTime).toBe(8);
    session.setWorldClockRate(4);
    session.wake(100);
    expect(worldTime).toBeCloseTo(8.2, 7);
    expect(() => session.setWorldClockRate(Number.NaN)).toThrow(RangeError);
    expect(() => session.setWorldClockRate(25)).toThrow(RangeError);
  });
});

import { createTestAuthorityExecution } from '../support/authority-execution';
import { expect, it } from 'vitest';
import { bodyConfigFor } from '../../src/physics/body-registry';
import { AuthoritySession, type AuthorityEntity } from '../../src/server/authority/authority-session';
import { Voxel } from '../../src/world/voxel';

const create = (measureNow?: () => number) => {
  let player: AuthorityEntity = { id: 'player', type: 'player', position: [0.5, 0, 0.5] };
  return new AuthoritySession({
    execution: createTestAuthorityExecution(),
    epoch: 'cost',
    playerId: 'player',
    startTimeMs: 0,
    measureNow,
    frequencies: { physicsHz: 60, gameplayHz: 20, fluidHz: 30 },
    bodyConfigFor: () => bodyConfigFor('player'),
    voxelSource: {
      getLoadedVoxel: (_x, y) => ({ voxel: y === -1 ? Voxel.Stone : Voxel.Air, chunkKey: 'loaded', revision: 0 }),
    },
    server: {
      worldRevision: 0,
      mutationCount: 0,
      worldTime: 9,
      getEntity: () => player,
      queryEntities: () => [player],
      updateEntity: (_id, update) => {
        player = { ...player, ...update };
      },
      advanceGameplayRules: () => undefined,
    },
  });
};

it('每次实际物理步独立计时，暂停和不欠步的唤醒不伪造样本', () => {
  const times = [0, 1, 10, 13, 20, 22];
  const session = create(() => times.shift()!);
  const actual = session.wake(50);
  expect(actual.physicsTick).toBe(3);
  expect(actual.diagnostics?.physicsCost).toEqual({ count: 3, capacity: 256, samplesMs: [1, 3, 2] });
  expect(session.wake(50).diagnostics?.physicsCost?.count).toBe(3);
  session.pause(50);
  expect(session.wake(500).diagnostics?.physicsCost?.count).toBe(3);
  expect(times).toEqual([]);
});

it('未提供测量时明确未采集，与启用测量的权威轨迹保持一致', () => {
  let time = 0;
  const measured = create(() => ++time).wake(50);
  const unmeasured = create().wake(50);
  expect(unmeasured.diagnostics?.physicsCost).toBeNull();
  expect(unmeasured.player).toEqual(measured.player);
  expect(unmeasured.integratedPhysicsTimeMs).toBe(measured.integratedPhysicsTimeMs);
});

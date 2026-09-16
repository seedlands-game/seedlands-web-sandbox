import { expect, it } from 'vitest';
import { assembleOverworldPacks, createGameplaySystemAuthority } from '@seedlands/stdlib/host';
import { pack } from '../../../../../../playbooks/classic/src/pack';
import { GameplayRuntime } from '../../../fixtures/classic/content';
import { capturedLegacyCompositionIdentity } from '../../../fixtures/classic/legacy-composition';
import {
  createGameplaySnapshotMetadata,
  type GameplaySnapshotV3,
} from '../../../../../../packages/stdlib/src/server/gameplay/gameplay-snapshot';
import { testCorePlatform } from '../../../../../../packages/stdlib/tests/support/core-platform';

function create() {
  const composition = assembleOverworldPacks([
    {
      ...pack,
      integrity: { algorithm: 'sha256', manifestDigest: 'a'.repeat(64), entryDigest: 'b'.repeat(64), resources: [] },
    },
  ]);
  const world = new GameplayRuntime({
    composition,
    moduleSystemAuthority: createGameplaySystemAuthority(composition),
    legacyCompositionIdentity: capturedLegacyCompositionIdentity(),
    platform: testCorePlatform,
    getWorldTime: () => 0,
    getVoxel: () => 0,
    prepareVoxelEdit: () => {
      throw new Error('unexpected edit');
    },
  });
  world.spawnPlayer({ id: 'alice', position: [0, 1, 0] });
  return world;
}

it('restores 512 retained actors, but rejects a 513-actor V3 or V4 before replacing the live world', () => {
  const source = create();
  for (let index = 0; index < 512; index++)
    source.spawnAutonomous(
      { id: `npc-${index}`, type: 'npc', archetype: 'settler', position: [index, 1, 3] },
      { archetype: 'settler' },
    );
  const good = source.createSnapshot();
  const restored = create();
  restored.restoreSnapshot(good);
  expect(restored.simulation.actorIds()).toHaveLength(512);
  source.entities.spawn({ id: 'overflow', type: 'npc', archetype: 'settler', position: [0, 1, 3] });
  const bad = source.createSnapshot();
  bad.simulation.actors.push({ ...bad.simulation.actors[0], entityId: 'overflow' });
  const legacy: GameplaySnapshotV3 = {
    version: 3,
    revision: bad.revision,
    gameplayTime: bad.gameplayTime,
    worldTime: bad.worldTime,
    ...createGameplaySnapshotMetadata(),
    entitySequence: bad.entityStore.sequence,
    entities: bad.entityStore.entities,
    players: [source.getPlayerState('alice')],
    simulation: bad.simulation,
  };
  for (const candidate of [bad, legacy]) {
    const current = create();
    current.giveItem('alice', { itemId: 'berry', count: 2 });
    const before = current.createSnapshot();
    const reference = current.entities.createReference('alice')!;
    expect(() => current.restoreSnapshot(candidate)).toThrow(/actor limit/i);
    expect(current.createSnapshot()).toEqual(before);
    expect(current.entities.resolveReference(reference)?.id).toBe('alice');
  }
});

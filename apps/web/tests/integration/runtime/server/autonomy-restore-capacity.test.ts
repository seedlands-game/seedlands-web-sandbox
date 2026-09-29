import { expect, it } from 'vitest';
import { assembleOverworldPacks, createGameplaySystemAuthority } from '@seedlands/stdlib/host';
import { GameplayRuntime } from '../../../fixtures/classic/content';
import { classicKernelMigrationCompositionIdentity } from '../../../../../../playbooks/classic/src/legacy-composition-identities';
import {
  createGameplaySnapshotMetadata,
  type GameplaySnapshotV3,
} from '../../../../../../packages/stdlib/src/server/gameplay/gameplay-snapshot';
import { testCorePlatform } from '../../../../../../packages/stdlib/tests/support/core-platform';
import { classicGameplayDomainModules } from './composition/classic-gameplay-domain-options';

function create() {
  const modules = classicGameplayDomainModules(['seedlands:overworld-content', 'seedlands:overworld-needs-rules']);
  const composition = assembleOverworldPacks([
    {
      manifest: {
        schemaVersion: 1,
        id: 'seedlands:overworld',
        version: '1.0.0',
        kind: 'playbook',
        entry: 'overworld.mjs',
        modules: modules.map(({ descriptor }) => descriptor),
      },
      modules,
      integrity: { algorithm: 'sha256', manifestDigest: 'a'.repeat(64), entryDigest: 'b'.repeat(64), resources: [] },
    },
  ]);
  const world = new GameplayRuntime({
    composition,
    moduleSystemAuthority: createGameplaySystemAuthority(composition),
    legacyCompositionIdentity: classicKernelMigrationCompositionIdentity,
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
      { id: `npc-${index}`, type: 'creature', archetype: 'zombie', position: [index, 1, 3] },
      { archetype: 'zombie' },
    );
  const good = source.createSnapshot();
  const restored = create();
  restored.restoreSnapshot(good);
  expect(restored.simulation.actorIds()).toHaveLength(512);
  source.entities.spawn({ id: 'overflow', type: 'creature', archetype: 'zombie', position: [0, 1, 3] });
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

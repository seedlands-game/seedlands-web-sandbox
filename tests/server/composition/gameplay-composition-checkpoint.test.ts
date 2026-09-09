import { describe, expect, it } from 'vitest';
import {
  assembleOverworldPacks,
  createGameplaySystemAuthority,
} from '@seedlands/game-core/server/composition/host-api';
import { pack } from '../../../packages/game-core/src/server/gameplay/playbooks/overworld/pack';
import { GameplayRuntime } from '../../../packages/game-core/src/server/gameplay/gameplay-runtime';
import { testCorePlatform } from '../../support/core-platform';

function create(digest = 'a') {
  const composition = assembleOverworldPacks([
    {
      ...pack,
      integrity: {
        algorithm: 'sha256',
        manifestDigest: digest.repeat(64),
        entryDigest: 'b'.repeat(64),
        resources: [],
      },
    },
  ]);
  return new GameplayRuntime({
    composition,
    moduleSystemAuthority: createGameplaySystemAuthority(composition),
    platform: testCorePlatform,
    getVoxel: () => 0,
    getWorldTime: () => 12,
    prepareVoxelEdit: () => {
      throw new Error('unused');
    },
  });
}

describe('gameplay composition checkpoint', () => {
  it('records the exact Pack lock, IDs, codecs and rule/system order and restores the same composition', () => {
    const source = create();
    source.spawnPlayer({ id: 'a', position: [0, 2, 0] });
    source.giveItem('a', { itemId: 'berry', count: 3 });
    const saved = source.createSnapshot();
    expect(saved.composition).toMatchObject({
      version: 1,
      playbookId: 'seedlands:overworld',
      packLock: [{ id: 'seedlands:overworld' }],
    });
    const target = create();
    target.restoreSnapshot(saved);
    expect(target.getInventory('a').slots[0]?.count).toBe(3);
  });

  it.each(['changed-digest', 'missing-identity', 'changed-codec'])(
    'rejects %s before replacing the active owner',
    (kind) => {
      const source = create();
      source.spawnPlayer({ id: 'saved', position: [0, 2, 0] });
      const saved = source.createSnapshot();
      if (kind === 'missing-identity') delete saved.composition;
      if (kind === 'changed-codec' && saved.composition)
        saved.composition = {
          ...saved.composition,
          definitionMap: { ...saved.composition.definitionMap, stateCodecs: [] },
        };
      const target = create(kind === 'changed-digest' ? 'c' : 'a');
      target.spawnPlayer({ id: 'current', position: [3, 2, 0] });
      const reference = target.entities.createReference('current')!;
      const before = target.createSnapshot();
      expect(() => target.restoreSnapshot(saved)).toThrow(/composition/i);
      expect(target.createSnapshot()).toEqual(before);
      expect(target.entities.resolveReference(reference)?.id).toBe('current');
    },
  );
});

import { describe, expect, it } from 'vitest';
import {
  assembleOverworldPacks,
  createGameplaySystemAuthority,
} from '@seedlands/game-core/server/composition/host-api';
import { pack } from '../../../packages/game-core/src/server/gameplay/playbooks/overworld/pack';
import { GameplayRuntime } from '../../../packages/game-core/src/server/gameplay/gameplay-runtime';
import { testCorePlatform } from '../../support/core-platform';

function create(digest = 'a', entryDigest = 'b'.repeat(64)) {
  const composition = assembleOverworldPacks([
    {
      ...pack,
      integrity: {
        algorithm: 'sha256',
        manifestDigest: digest.length === 1 ? digest.repeat(64) : digest,
        entryDigest,
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

  it('migrates only the exact pre-pointer overworld V4 Pack identity', () => {
    const source = create(
      '05bc5e57bb6cfd4ed0e2da821f8b6e803bb7e3676453988a131a4b8524c066dd',
      '4a773fe7225f13ef018def0a930b469aa82e558fdebc5172b7ef602ed8e148e2',
    );
    source.spawnPlayer({ id: 'saved', position: [0, 2, 0] });
    source.giveItem('saved', { itemId: 'plank', count: 9 });
    const saved = source.createSnapshot();
    const legacyActor = saved.entityStore.actors.find((actor) => actor.entityId === 'saved')! as {
      inventoryRevision?: number;
      inventoryCursor?: unknown;
    };
    delete legacyActor.inventoryRevision;
    delete legacyActor.inventoryCursor;
    const target = create('c');

    expect(target.restoreSnapshot(saved)).toEqual({ version: 4, worldTime: 12 });
    expect(target.getInventory('saved').slots[0]).toEqual({ itemId: 'plank', count: 9 });
    expect(target.getInventoryPointerView('saved')).toMatchObject({ revision: 0, cursor: { stack: null } });

    const altered = structuredClone(saved) as typeof saved & {
      composition: { packLock: Array<{ integrity: { entryDigest: string } }> };
    };
    altered.composition.packLock[0]!.integrity.entryDigest = `0${altered.composition.packLock[0]!.integrity.entryDigest.slice(1)}`;
    const before = target.createSnapshot();
    expect(() => target.restoreSnapshot(altered)).toThrow(/composition/i);
    expect(target.createSnapshot()).toEqual(before);
  });
});

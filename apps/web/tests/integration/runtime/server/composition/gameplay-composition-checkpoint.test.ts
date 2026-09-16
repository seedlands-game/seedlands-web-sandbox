import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  assembleOverworldPacks,
  createGameplayActorAuthority,
  createGameplaySystemAuthority,
} from '@seedlands/stdlib/host';
import { pack } from '../../../../../../../playbooks/classic/src/pack';
import { GameplayRuntime } from '../../../../fixtures/classic/content';
import { capturedLegacyCompositionIdentity } from '../../../../fixtures/classic/legacy-composition';
import type { CompositionCheckpointIdentity } from '../../../../../../../packages/stdlib/src/server/composition/checkpoint-identity';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';

function create(digest = 'a', entryDigest = 'b'.repeat(64), legacyCompositionIdentity?: CompositionCheckpointIdentity) {
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
    moduleActorAuthority: createGameplayActorAuthority(composition.resources, { playerAlias: 'test-player' }),
    moduleSystemAuthority: createGameplaySystemAuthority(composition),
    legacyCompositionIdentity,
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
    const frozenBase = JSON.parse(
      gunzipSync(
        readFileSync(new URL('../../../../fixtures/checkpoints/base-checkpoint.json.gz', import.meta.url)),
      ).toString('utf8'),
    ) as { args: [{ snapshot: { gameplay: { composition: { definitionMap: unknown } } } }] };
    // The old digest must carry its frozen registration graph, not the current module graph.
    const legacySaved = {
      ...saved,
      composition: {
        ...saved.composition,
        definitionMap: frozenBase.args[0].snapshot.gameplay.composition.definitionMap,
      },
    };
    const legacyActor = saved.entityStore.actors.find((actor) => actor.entityId === 'saved')! as {
      inventoryRevision?: number;
      inventoryCursor?: unknown;
    };
    delete legacyActor.inventoryRevision;
    delete legacyActor.inventoryCursor;
    const target = create('c');

    expect(target.restoreSnapshot(legacySaved)).toEqual({ version: 4, worldTime: 12 });
    expect(target.getInventory('saved').slots[0]).toEqual({ itemId: 'plank', count: 9 });
    expect(target.getInventoryPointerView('saved')).toMatchObject({ revision: 0, cursor: { stack: null } });

    const altered = structuredClone(legacySaved) as typeof saved & {
      composition: { packLock: Array<{ integrity: { entryDigest: string } }> };
    };
    altered.composition.packLock[0]!.integrity.entryDigest = `0${altered.composition.packLock[0]!.integrity.entryDigest.slice(1)}`;
    const before = target.createSnapshot();
    expect(() => target.restoreSnapshot(altered)).toThrow(/composition/i);
    expect(target.createSnapshot()).toEqual(before);
  });

  it('restores the exact main 6c7124a V4 fixture without losing actor state', () => {
    const fixtureRoot = new URL('../../../../fixtures/npc/', import.meta.url);
    const composition = JSON.parse(readFileSync(new URL('main-composition.json', fixtureRoot), 'utf8')) as {
      identity: unknown;
    };
    const fixture = JSON.parse(readFileSync(new URL('main-gameplay.json', fixtureRoot), 'utf8')) as {
      gameplay: Record<string, unknown>;
    };
    const saved = { ...fixture.gameplay, composition: composition.identity };
    const target = create('c');

    expect(target.restoreSnapshot(saved)).toEqual({ version: 4, worldTime: 12 });
    expect(target.getInventory('main-player').slots.slice(0, 2)).toEqual([
      { itemId: 'berry', count: 3 },
      { itemId: 'wood-axe', count: 1, instance: { durability: 41 } },
    ]);
    expect(target.getInventory('main-settler').slots[0]).toEqual({ itemId: 'plank', count: 9 });
    expect(target.entities.actorStateAccess('main-settler').controlSource).toBe('autonomous');

    const altered = structuredClone(saved) as {
      composition: { definitionMap: { operations: Array<{ id: string }> } };
    };
    altered.composition.definitionMap.operations.pop();
    const before = target.createSnapshot();
    expect(() => target.restoreSnapshot(altered)).toThrow(/composition/i);
    expect(target.createSnapshot()).toEqual(before);
  });

  it('migrates legacy Character V1/V2 bodies into the ECS actor owner with 24 slots', () => {
    const source = create();
    const created = source.character({
      kind: 'create',
      profile: { name: '旧旅者', personality: '谨慎而节俭。' },
      position: [2.5, 2, 0.5],
    });
    if (created.kind !== 'created') throw new Error('Character fixture was not created.');
    const entityId = created.character.entityId;
    source.giveItem(entityId, { itemId: 'berry', count: 3 });
    source.giveItem(entityId, { itemId: 'wood-axe', count: 1, instance: { durability: 41 } });
    const current = source.createSnapshot();
    const actor = current.entityStore.actors.find((entry) => entry.entityId === entityId);
    if (!actor?.character) throw new Error('Character component fixture is missing.');
    const legacy = {
      version: 3 as const,
      revision: current.revision,
      gameplayTime: current.gameplayTime,
      entitySequence: current.entityStore.sequence,
      entities: current.entityStore.entities,
      players: [],
      worldTime: current.worldTime,
      coordinateSchema: current.coordinateSchema,
      physicsSchema: current.physicsSchema,
      simulation: {
        ...current.simulation,
        characters: {
          version: 2 as const,
          sequence: 1,
          characters: [
            {
              ...actor.character,
              inventory: actor.inventory.slice(0, 12),
              hunger: actor.needs.hunger,
            },
          ],
        },
      },
    };
    const target = create('c', 'b'.repeat(64), capturedLegacyCompositionIdentity());

    expect(target.restoreSnapshot(legacy)).toEqual({ version: 3, worldTime: 12 });
    const migrated = target.createSnapshot().entityStore.actors.find((entry) => entry.entityId === entityId);
    expect(migrated).toMatchObject({
      controlSource: 'behavior',
      character: { incarnation: actor.character.incarnation },
    });
    expect(migrated?.inventory).toHaveLength(24);
    expect(migrated?.inventory.slice(0, 2)).toEqual([
      { itemId: 'berry', count: 3 },
      { itemId: 'wood-axe', count: 1, instance: { durability: 41 } },
    ]);
    expect(migrated?.inventory.slice(12)).toEqual(Array.from({ length: 12 }, () => null));
    expect(target.character({ kind: 'inspect', entityId })).toMatchObject({
      kind: 'state',
      character: { lifecycle: 'active', inventory: expect.any(Array) },
    });

    const legacyV1Characters = legacy.simulation.characters.characters.map((character) => {
      const migrated = structuredClone(character) as Omit<typeof character, 'behaviorTree'> & {
        behaviorTree?: unknown;
      };
      delete migrated.behaviorTree;
      return migrated;
    });
    const legacyV1 = {
      ...legacy,
      simulation: {
        ...legacy.simulation,
        characters: { ...legacy.simulation.characters, version: 1 as const, characters: legacyV1Characters },
      },
    };
    const v1Target = create('c', 'b'.repeat(64), capturedLegacyCompositionIdentity());
    expect(v1Target.restoreSnapshot(legacyV1)).toEqual({ version: 3, worldTime: 12 });
    const v1Migrated = v1Target.createSnapshot().entityStore.actors.find((entry) => entry.entityId === entityId);
    expect(v1Migrated).toMatchObject({
      controlSource: 'behavior',
      character: { incarnation: actor.character.incarnation, behaviorTree: { revision: 1 } },
    });
    expect(v1Migrated?.inventory.slice(0, 2)).toEqual([
      { itemId: 'berry', count: 3 },
      { itemId: 'wood-axe', count: 1, instance: { durability: 41 } },
    ]);

    const altered = structuredClone(legacy);
    altered.simulation.characters.characters[0]!.hunger += 1;
    const before = target.createSnapshot();
    expect(() => target.restoreSnapshot(altered)).toThrow(/needs do not match/i);
    expect(target.createSnapshot()).toEqual(before);
  });
});

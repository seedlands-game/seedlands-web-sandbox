import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  assembleOverworldPacks,
  createGameplayActorAuthority,
  createGameplaySystemAuthority,
} from '@seedlands/stdlib/host';
import { pack } from '../../../../../../../playbooks/classic/src/pack';
import { classicGameplaySnapshotPredecessors } from '../../../../../../../playbooks/classic/src/legacy-composition-identities';
import { GameplayRuntime } from '../../../../fixtures/classic/content';
import type { CompositionCheckpointIdentity } from '../../../../../../../packages/stdlib/src/server/composition/checkpoint-identity';
import { prepareWorldCommitMetadata } from '../../../../../../../packages/stdlib/src/server/prepared-world-commit-metadata';
import { prepareWorldEditBatch } from '../../../../../../../packages/stdlib/src/server/world-transaction-commit';
import type { ServerChunk } from '../../../../../../../packages/stdlib/src/server/game-server-types';
import { CHUNK_SIZE, chunkKey, floorDiv, mod, voxelIndex } from '@seedlands/stdlib/world/voxel';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';

const PRECHANGE_CLASSIC_PACK_INTEGRITY = {
  manifestDigest: '74d0a1a50d2812053fa442ae00137d285dd6b80954c3e21d788053eb2ec243f2',
  entryDigest: 'a0822ae7e3ae985c47db22deee54d77f788a0cd72eece3f4a4c46a4c6037eee6',
} as const;
const PRE_MEDIA_CLASSIC_PACK_INTEGRITY = {
  manifestDigest: '8c85965878299e56d918bdc89302789d38a26d3a04a1d924fe4e885daca3fae4',
  entryDigest: '9a22f2d679b8a00bba8a66658457de477c1b05500cf353fb7ed368c6d69bf12a',
} as const;
const PRESENTATION_DIGEST = 'a1e379e5e8a9d5f5d41ef7ce204863af0d0cfe41b9e3081e138d87d2517d9f5b';
const MEDIA_OPERATION_IDS = new Set([
  'seedlands:media-activate',
  'seedlands:media-eject',
  'seedlands:media-insert',
  'seedlands:media-insert-and-activate',
  'seedlands:media-stop',
  'seedlands:media-switch',
]);
function prechangeClassicIdentity(): CompositionCheckpointIdentity {
  const composition = JSON.parse(
    readFileSync(new URL('../../../../fixtures/npc/main-composition.json', import.meta.url), 'utf8'),
  ) as { identity: CompositionCheckpointIdentity };
  const pack = composition.identity.packLock[0]!;
  return {
    ...composition.identity,
    packLock: [
      {
        ...pack,
        integrity: { ...pack.integrity, ...PRECHANGE_CLASSIC_PACK_INTEGRITY },
      },
    ],
  };
}

function preMediaClassicIdentity(current: CompositionCheckpointIdentity): CompositionCheckpointIdentity {
  const pack = current.packLock[0]!;
  return {
    ...current,
    packLock: [
      {
        ...pack,
        integrity: {
          algorithm: 'sha256',
          ...PRE_MEDIA_CLASSIC_PACK_INTEGRITY,
          resources: [{ path: 'playbooks/classic/presentation.json', digest: PRESENTATION_DIGEST }],
        },
      },
    ],
    definitionMap: {
      ...current.definitionMap,
      modules: current.definitionMap.modules.filter(
        ({ id }) => id !== 'seedlands:overworld-media' && id !== 'seedlands:overworld-death-inventory-policy',
      ),
      capabilities: current.definitionMap.capabilities.filter(
        ({ id }) => id !== 'seedlands:media-playback' && id !== 'seedlands:death-inventory-policy',
      ),
      resources: current.definitionMap.resources.filter(({ id }) => id !== 'seedlands.media-playback'),
      stateCodecs: current.definitionMap.stateCodecs.filter(({ id }) => id !== 'seedlands:media-playback-device'),
      operations: current.definitionMap.operations.filter(({ id }) => !MEDIA_OPERATION_IDS.has(id)),
    },
  };
}

function create(digest = 'a', entryDigest = 'b'.repeat(64)) {
  const composition = assembleOverworldPacks([
    {
      ...pack,
      integrity: {
        algorithm: 'sha256',
        manifestDigest: digest.length === 1 ? digest.repeat(64) : digest,
        entryDigest,
        resources: pack.manifest.resources!.map((path) => ({ path, digest: 'd'.repeat(64) })),
      },
    },
  ]);
  const chunks = new Map<string, ServerChunk>();
  const chunkAt = (cx: number, cy: number, cz: number) => {
    const key = chunkKey(cx, cy, cz);
    let chunk = chunks.get(key);
    if (!chunk) {
      chunk = {
        key,
        cx,
        cy,
        cz,
        voxels: new Uint16Array(CHUNK_SIZE ** 3),
        fluid: new Uint8Array(CHUNK_SIZE ** 3),
        revision: 0,
        persistedRevision: 0,
        dirty: false,
        materialized: false,
        accessEpoch: 0,
      };
      chunks.set(key, chunk);
    }
    return chunk;
  };
  const readCell = ([x, y, z]: readonly [number, number, number]) => {
    const chunk = chunkAt(floorDiv(x, CHUNK_SIZE), floorDiv(y, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE));
    const index = voxelIndex(mod(x, CHUNK_SIZE), mod(y, CHUNK_SIZE), mod(z, CHUNK_SIZE));
    return { voxel: chunk.voxels[index]!, fluid: chunk.fluid[index]! };
  };
  let mutations = 0;
  const runtime = new GameplayRuntime({
    composition,
    moduleActorAuthority: createGameplayActorAuthority(composition.resources, { playerAlias: 'test-player' }),
    moduleSystemAuthority: createGameplaySystemAuthority(composition),
    platform: testCorePlatform,
    getVoxel: (position) => readCell(position).voxel,
    getLoadedCell: readCell,
    getWorldTime: () => 12,
    prepareVoxelEdit: (actorId, position, value) => {
      const current = readCell(position);
      return prepareWorldEditBatch(
        {
          getChunk: chunkAt,
          getRevision: () => runtime.kernelState.worldRevision,
          prepareCommitMetadata: (revision, count) =>
            prepareWorldCommitMetadata(runtime.kernelState, revision, count, {
              get: () => mutations,
              set: (value) => (mutations = value),
            }),
          isVoxelRegistered: (voxel) => composition.definitionMap.voxels.some(({ storageId }) => storageId === voxel),
        },
        actorId,
        [
          {
            x: position[0],
            y: position[1],
            z: position[2],
            value,
            expectedVoxel: current.voxel,
            expectedFluid: current.fluid,
          },
        ],
        () => 0,
      );
    },
    prepareVoxelEdits: (actorId, edits) =>
      prepareWorldEditBatch(
        {
          getChunk: chunkAt,
          getRevision: () => runtime.kernelState.worldRevision,
          prepareCommitMetadata: (revision, count) =>
            prepareWorldCommitMetadata(runtime.kernelState, revision, count, {
              get: () => mutations,
              set: (value) => (mutations = value),
            }),
          isVoxelRegistered: (voxel) => composition.definitionMap.voxels.some(({ storageId }) => storageId === voxel),
        },
        actorId,
        edits,
        () => 0,
      ),
  });
  return runtime;
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
    const source = create();
    source.spawnPlayer({ id: 'saved', position: [0, 2, 0] });
    source.giveItem('saved', { itemId: 'plank', count: 9 });
    const legacySaved = source.createSnapshot();
    const predecessor = classicGameplaySnapshotPredecessors[1]!;
    expect(predecessor.gameplayVersions).toEqual([4]);
    expect(predecessor.identity.packLock[0]!.integrity).toEqual({
      algorithm: 'sha256',
      manifestDigest: '05bc5e57bb6cfd4ed0e2da821f8b6e803bb7e3676453988a131a4b8524c066dd',
      entryDigest: '4a773fe7225f13ef018def0a930b469aa82e558fdebc5172b7ef602ed8e148e2',
      resources: [],
    });
    // This is a synthetic V4 payload under Classic's frozen pre-pointer source envelope.
    legacySaved.composition = structuredClone(predecessor.identity);
    const legacyActor = legacySaved.entityStore.actors.find((actor) => actor.entityId === 'saved')! as {
      inventoryRevision?: number;
      inventoryCursor?: unknown;
    };
    delete legacyActor.inventoryRevision;
    delete legacyActor.inventoryCursor;
    const altered = structuredClone(legacySaved);
    const alteredPack = altered.composition!.packLock[0]!;
    altered.composition = {
      ...altered.composition!,
      packLock: [
        {
          ...alteredPack,
          integrity: {
            ...alteredPack.integrity,
            entryDigest: `0${alteredPack.integrity.entryDigest.slice(1)}`,
          },
        },
      ],
    };
    const target = create('c');

    expect(target.restoreSnapshot(legacySaved)).toEqual({ version: 4, worldTime: 12 });
    expect(target.getInventory('saved').slots[0]).toEqual({ itemId: 'plank', count: 9 });
    expect(target.getInventoryPointerView('saved')).toMatchObject({ revision: 0, cursor: { stack: null } });

    const before = target.createSnapshot();
    expect(() => target.restoreSnapshot(altered)).toThrow(/composition/i);
    expect(target.createSnapshot()).toEqual(before);
  });

  it('migrates only the exact pre-Media Classic V4 identity and installs an empty Media child', () => {
    const source = create();
    source.spawnPlayer({ id: 'saved', position: [0, 2, 0] });
    source.giveItem('saved', { itemId: 'record-13', count: 1 });
    const saved = source.createSnapshot();
    saved.composition = preMediaClassicIdentity(saved.composition!);
    delete saved.media;
    const target = create('c');

    expect(target.restoreSnapshot(saved)).toEqual({ version: 4, worldTime: 12 });
    expect(target.getInventory('saved').slots[0]).toEqual({ itemId: 'record-13', count: 1 });
    expect(target.media.projections()).toEqual([]);

    const altered = structuredClone(saved);
    altered.composition!.definitionMap.operations.pop();
    const before = target.createSnapshot();
    expect(() => target.restoreSnapshot(altered)).toThrow(/composition/i);
    expect(target.createSnapshot()).toEqual(before);
  });

  it('filters the retired settler from the exact pre-change Classic V4 graph while preserving the player', () => {
    const fixtureRoot = new URL('../../../../fixtures/npc/', import.meta.url);
    const fixture = JSON.parse(readFileSync(new URL('main-gameplay.json', fixtureRoot), 'utf8')) as {
      gameplay: Record<string, unknown>;
    };
    const saved = { ...fixture.gameplay, composition: prechangeClassicIdentity() };
    const target = create('c');

    expect(target.restoreSnapshot(saved)).toEqual({ version: 4, worldTime: 12 });
    expect(target.getInventory('main-player').slots.slice(0, 2)).toEqual([
      { itemId: 'berry', count: 3 },
      { itemId: 'wood-axe', count: 1, instance: { durability: 41 } },
    ]);
    expect(target.getEntity('main-settler')).toBeNull();
    expect(target.snapshotMigrationReports).toEqual([
      { id: 'seedlands:classic-retired-actors-v1', removedActorIds: ['main-settler'] },
    ]);

    const altered = structuredClone(saved) as {
      composition: { definitionMap: { operations: Array<{ id: string }> } };
    };
    altered.composition.definitionMap.operations.pop();
    const before = target.createSnapshot();
    expect(() => target.restoreSnapshot(altered)).toThrow(/composition/i);
    expect(target.createSnapshot()).toEqual(before);
  });

  it('reprojects an exact pre-change save with no retired entities and clears retired melee state without a report', () => {
    const source = create('a');
    source.spawnPlayer({ id: 'keeper', position: [0, 2, 0] });
    source.spawnAutonomous(
      { id: 'pig', type: 'creature', archetype: 'pig', position: [2, 2, 0], health: 10, maxHealth: 10 },
      { archetype: 'pig' },
    );
    source.giveItem('keeper', { itemId: 'plank', count: 9 });
    const saved = source.createSnapshot();
    saved.composition = prechangeClassicIdentity();
    saved.simulation.combat = {
      version: 3,
      actionSequence: 1,
      resultSequence: 0,
      combatants: [
        {
          actorId: 'keeper',
          actorIdentity: null,
          combat: {
            active: {
              actionId: 'legacy-claw',
              definitionId: 'night-stalker-claw',
              targetId: 'pig',
              comboStep: 0,
              comboLength: 1,
              phase: 'windup',
              phaseElapsedSeconds: 0,
              phaseDurationSeconds: 0.3,
              canBuffer: false,
              buffered: false,
              targetIdentity: null,
              bufferedTargetId: null,
              bufferedTargetIdentity: null,
              origin: {} as never,
              bufferedOrigin: null,
            },
            cooldownRemainingSeconds: 0,
            lastResult: null,
            pendingHit: null,
          },
        },
      ],
    };
    const original = structuredClone(saved);
    const target = create('d');

    expect(target.restoreSnapshot(saved)).toEqual({ version: 4, worldTime: 12 });
    expect(
      target
        .queryEntities()
        .map((entity) => entity.id)
        .sort(),
    ).toEqual(['keeper', 'pig']);
    expect(target.getInventory('keeper').slots[0]).toEqual({ itemId: 'plank', count: 9 });
    expect(target.simulation.snapshot().combat?.combatants).toEqual([]);
    expect(target.snapshotMigrationReports).toEqual([]);
    const reprojected = target.createSnapshot();
    expect(target.restoreSnapshot(reprojected)).toEqual({ version: 4, worldTime: 12 });
    expect(target.snapshotMigrationReports).toEqual([]);
    expect(saved).toEqual(original);
  });

  it('removes only retired Classic actors and their in-flight references from an older Overworld V4 save', () => {
    const source = create('a');
    source.spawnPlayer({ id: 'keeper', position: [0, 2, 0] });
    source.spawnAutonomous(
      { id: 'pig', type: 'creature', archetype: 'pig', position: [2, 2, 0], health: 10, maxHealth: 10 },
      { archetype: 'pig' },
    );
    source.giveItem('keeper', { itemId: 'plank', count: 9 });
    const saved = source.createSnapshot();
    const keeper = saved.entityStore.entities.find((entity) => entity.id === 'keeper')!;
    const keeperActor = saved.entityStore.actors.find((actor) => actor.entityId === 'keeper')!;
    const retired = [
      ['legacy-grazer', 'grazer', 'creature'],
      ['legacy-stalker', 'night-stalker', 'creature'],
      ['legacy-settler', 'settler', 'npc'],
    ] as const;
    for (const [id, archetype, type] of retired) {
      saved.entityStore.lifetimeHighWater += 1;
      saved.entityStore.entities.push({
        ...keeper,
        id,
        type,
        kind: type,
        archetype,
        position: [4, 2, 0],
        health: type === 'npc' ? 20 : 12,
        maxHealth: type === 'npc' ? 20 : 12,
      });
      saved.entityStore.identities.push({ entityId: id, lifetime: saved.entityStore.lifetimeHighWater });
      saved.entityStore.issuedIds.push(id);
      saved.entityStore.actors.push({ ...keeperActor, entityId: id });
      saved.simulation.actors.push({
        entityId: id,
        archetype,
        hunger: 0,
        behavior: 'idle',
        targetEntityId: null,
        homePoiId: null,
        workPoiId: null,
        foodPoiId: null,
        active: true,
        wanderIndex: 0,
      });
    }
    saved.simulation.actions = {
      version: 2,
      sequence: 2,
      actions: [
        {
          id: 'action-1',
          actorId: 'legacy-stalker',
          type: 'attack',
          status: 'running',
          targetEntityId: 'keeper',
          startedAt: 0,
          path: [],
          pathIndex: 0,
          repathCount: 0,
        },
        {
          id: 'action-2',
          actorId: 'keeper',
          type: 'move-to',
          status: 'running',
          targetEntityId: 'legacy-grazer',
          startedAt: 0,
          path: [],
          pathIndex: 0,
          repathCount: 0,
        },
      ],
    };
    saved.simulation.combat = {
      version: 3,
      actionSequence: 1,
      resultSequence: 0,
      combatants: [
        {
          actorId: 'keeper',
          actorIdentity: null,
          combat: {
            active: {
              actionId: 'action-2',
              definitionId: 'night-stalker-claw',
              targetId: 'legacy-grazer',
              comboStep: 0,
              comboLength: 1,
              phase: 'windup',
              phaseElapsedSeconds: 0,
              phaseDurationSeconds: 0.3,
              canBuffer: false,
              buffered: false,
              targetIdentity: { entityId: 'legacy-grazer', epoch: 1, lifetime: 2 },
              bufferedTargetId: null,
              bufferedTargetIdentity: null,
              origin: {} as never,
              bufferedOrigin: null,
            },
            cooldownRemainingSeconds: 0,
            lastResult: null,
            pendingHit: null,
          },
        },
      ],
    };
    saved.composition = prechangeClassicIdentity();
    const original = structuredClone(saved);
    const target = create('d');

    expect(target.restoreSnapshot(saved)).toEqual({ version: 4, worldTime: 12 });
    expect(
      target
        .queryEntities()
        .map((entity) => entity.id)
        .sort(),
    ).toEqual(['keeper', 'pig']);
    expect(target.getInventory('keeper').slots[0]).toEqual({ itemId: 'plank', count: 9 });
    expect(target.simulation.snapshot().actors.map((actor) => actor.entityId)).toEqual(['pig']);
    expect(target.simulation.snapshot().actions.actions).toEqual([]);
    expect(target.simulation.snapshot().combat?.combatants).toEqual([]);
    expect(target.snapshotMigrationReports).toEqual([
      {
        id: 'seedlands:classic-retired-actors-v1',
        removedActorIds: ['legacy-grazer', 'legacy-settler', 'legacy-stalker'],
      },
    ]);
    const migrated = target.createSnapshot();
    expect(target.restoreSnapshot(migrated)).toEqual({ version: 4, worldTime: 12 });
    expect(target.snapshotMigrationReports).toEqual([]);
    expect(saved).toEqual(original);
  });
});

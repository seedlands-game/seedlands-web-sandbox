import { MemoryGamePersistence } from '../../../../../../../packages/stdlib/src/server/persistence/memory-game-persistence';
import { expect, it } from 'vitest';
import {
  definePack,
  defineContentModule,
  defineStationActionsModule,
  defineBlockActionsModule,
  defineBlockRulesModule,
} from '@seedlands/stdlib/mod-api';
import {
  assembleWorldPacks,
  createGameplayActorAuthority,
  createGameplaySystemAuthority,
} from '@seedlands/stdlib/host';
import { GameServer } from '../../../../fixtures/classic/content';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';
function setup(hook?: (value: unknown) => void, persistence?: MemoryGamePersistence) {
  const modules = [
    defineContentModule({
      moduleId: 'test:content',
      items: [
        {
          id: 'test:bench',
          name: 'Bench',
          itemType: 'block',
          stackLimit: 64,
          capabilities: [{ type: 'place', voxel: 10 }],
        },
        { id: 'test:ore', name: 'Ore', itemType: 'resource', stackLimit: 64, capabilities: [] },
      ],
      meleeDefinitions: [],
      stations: { definitions: [{ kind: 'workbench', voxel: 10 }], recipes: [], furnaceRecipes: [], fuels: [] },
    }),
    defineStationActionsModule(),
    defineBlockActionsModule({ stations: true }),
    defineBlockRulesModule({
      moduleId: 'test:block-rules',
      voxelDefinitions: [
        { voxel: 0, hardnessSeconds: null, preferredTool: null, drop: null, replaceable: true },
        {
          voxel: 10,
          hardnessSeconds: 0.2,
          preferredTool: null,
          drop: { itemId: 'test:bench', count: 1 },
          replaceable: false,
        },
      ],
    }),
  ];
  const pack = definePack({ id: 'test:block-stations', kind: 'playbook', version: '1.0.0', modules });
  const composition = assembleWorldPacks(
    [
      {
        ...pack,
        integrity: { algorithm: 'sha256', manifestDigest: 'a'.repeat(64), entryDigest: 'b'.repeat(64), resources: [] },
      },
    ],
    { approvedPermissions: { 'test:block-stations': modules.flatMap((m) => m.descriptor.permissions ?? []) } },
  );
  const server = new GameServer({
    seedText: 'block-stations',
    persistence,
    platform: {
      ...testCorePlatform,
      clone: <T>(value: T): T => {
        hook?.(value);
        return structuredClone(value);
      },
    },
    composition,
    moduleActorAuthority: createGameplayActorAuthority(composition.resources, { playerAlias: 'human' }),
    moduleSystemAuthority: createGameplaySystemAuthority(composition),
  });
  server.editBatch({
    actorId: 'fixture',
    edits: [
      { x: 0, y: 60, z: 0, value: 0 },
      { x: 1, y: 60, z: 0, value: 0 },
      { x: 2, y: 60, z: 0, value: 0 },
    ],
  });
  server.spawnPlayer({ id: 'player', position: [0.5, 60, 0.5] });
  server.giveItem('player', { itemId: 'test:bench', count: 2 });
  return server;
}
const stations = (server: GameServer) => server.freezePortableSaveSnapshot().gameplay.entityStore;
it('places an ECS station with its voxel and retires the instance on ordinary mining', () => {
  const server = setup();
  {
    const placed = server.placeVoxel('player', [2, 60, 0]);
    expect(placed.success, JSON.stringify(placed)).toBe(true);
  }
  const snapshot = stations(server);
  expect(snapshot.version).toBe(2);
  if (snapshot.version !== 2) throw new Error('Expected V2');
  expect(snapshot.stations).toHaveLength(1);
  const id = snapshot.stations[0].entityId;
  expect(server.beginBreak('player', [2, 60, 0])).toMatchObject({ success: true });
  server.advanceGameplayRules(0.2);
  expect(server.getVoxel(2, 60, 0)).toBe(0);
  expect(server.getEntity(id)).toBeNull();
  expect(server.queryEntities({ type: 'world-item' }).map((entity) => entity.stack)).toEqual([
    { itemId: 'test:bench', count: 1 },
  ]);
  {
    const placed = server.placeVoxel('player', [2, 60, 0]);
    expect(placed.success, JSON.stringify(placed)).toBe(true);
  }
  const after = stations(server);
  if (after.version !== 2) throw new Error('Expected V2');
  expect(after.stations[0].entityId).not.toBe(id);
});
it('does not allocate a station or write a voxel when final clone fails', () => {
  let fail = false;
  const server = setup((value) => {
    if (fail && value && typeof value === 'object' && 'kind' in value && value.kind === 'place' && 'success' in value)
      throw new Error('fixture-clone');
  });
  const before = server.freezePortableSaveSnapshot();
  fail = true;
  expect(server.placeVoxel('player', [2, 60, 0]).success).toBe(false);
  fail = false;
  expect(server.freezePortableSaveSnapshot()).toEqual(before);
});

it('rejects raw creation and destruction before any part of the world edit commits', () => {
  const server = setup();
  expect(() =>
    server.editBatch({
      actorId: 'fixture',
      edits: [
        { x: 1, y: 60, z: 0, value: 3 },
        { x: 2, y: 60, z: 0, value: 10 },
      ],
    }),
  ).toThrow(/station-aware/);
  expect(server.getVoxel(1, 60, 0)).toBe(0);
  expect(() => server.edit(2, 60, 0, 10, 'fixture')).toThrow(/station-aware/);
  {
    const placed = server.placeVoxel('player', [2, 60, 0]);
    expect(placed.success, JSON.stringify(placed)).toBe(true);
  }
  const before = server.freezePortableSaveSnapshot();
  expect(() => server.editBatch({ actorId: 'fixture', edits: [{ x: 2, y: 60, z: 0, value: 0 }] })).toThrow(
    /station-aware/,
  );
  expect(() => server.edit(2, 60, 0, 0, 'fixture')).toThrow(/station-aware/);
  expect(server.freezePortableSaveSnapshot()).toEqual(before);
});

it('rejects checkpoint station entity/voxel mismatches using candidate bytes only', () => {
  const server = setup();
  expect(server.placeVoxel('player', [2, 60, 0]).success).toBe(true);
  const saved = server.freezePortableSaveSnapshot();
  expect(() => server.validateStationCheckpoint(saved)).not.toThrow();
  const missingVoxel = structuredClone(saved);
  const chunk = missingVoxel.chunks.find((chunk) => chunk.cx === 0 && chunk.cy === 1 && chunk.cz === 0)!;
  chunk.voxels[2 + 32 * (0 + 32 * 28)] = 0;
  expect(() => server.validateStationCheckpoint(missingVoxel)).toThrow(/no matching voxel/);
  const missingEntity = structuredClone(saved),
    owner = missingEntity.gameplay.entityStore;
  if (owner.version !== 2) throw new Error('Expected V2');
  owner.stations = [];
  owner.entities = owner.entities.filter((entity) => entity.type !== 'station');
  expect(() => server.validateStationCheckpoint(missingEntity)).toThrow(/no matching entity/);
  expect(server.freezePortableSaveSnapshot()).toEqual(saved);
});

it('destroys stored contents with the station in one ordinary mining commit', () => {
  const server = setup();
  expect(server.placeVoxel('player', [2, 60, 0]).success).toBe(true);
  const owner = stations(server);
  if (owner.version !== 2) throw new Error('Expected V2');
  const stationId = owner.stations[0].entityId;
  server.giveItem('player', { itemId: 'test:ore', count: 3 });
  const authority = createGameplayActorAuthority(server.gameplayResources, { playerAlias: 'human' }).forActor(
    'player',
    'player',
  )!;
  const result = server.invokeModuleOperation(
    authority.authorizer,
    { principalId: authority.principalId, originalActorId: 'player' },
    {
      operationId: 'seedlands:station-transfer',
      target: { kind: 'entity', entityId: stationId },
      input: { expectedStationRevision: 0, from: 'actor', actorSlot: 1, stationSlot: 4, count: 3 },
    },
  );
  expect(result).toMatchObject({ ok: true });
  expect(server.beginBreak('player', [2, 60, 0])).toMatchObject({ success: true });
  server.advanceGameplayRules(0.2);
  expect(server.getEntity(stationId)).toBeNull();
  expect(server.queryEntities({ type: 'world-item' }).map((entity) => entity.stack)).toEqual([
    { itemId: 'test:bench', count: 1 },
    { itemId: 'test:ore', count: 3 },
  ]);
  expect(server.getInventory('player').slots[1]).toBeNull();
});
it('projects only readable reachable station state and routes player actions with the existing authority', () => {
  const server = setup();
  expect(server.placeVoxel('player', [2, 60, 0]).success).toBe(true);
  const view = server.getNearbyStations('player');
  expect(view).toHaveLength(1);
  const station = view[0];
  expect(
    server.invokeActorModuleOperation('player', {
      operationId: 'seedlands:station-transfer',
      target: { kind: 'entity', entityId: station.reference.entityId },
      input: {
        expectedStationRevision: station.component.revision,
        from: 'actor',
        actorSlot: 0,
        stationSlot: 0,
        count: 1,
      },
    }),
  ).toMatchObject({ ok: true });
  const current = server.getNearbyStations('player')[0].component;
  expect(current.kind === 'workbench' && current.grid[0]).toEqual({ itemId: 'test:bench', count: 1 });
  server.updateEntity('player', { position: [20, 60, 0] });
  expect(server.getNearbyStations('player')).toEqual([]);
});
it('pins station chunks after saving and validates station bytes on ordinary persistence restore', async () => {
  const persistence = new MemoryGamePersistence({ clone: structuredClone });
  const server = setup(undefined, persistence);
  expect(server.placeVoxel('player', [2, 60, 0]).success).toBe(true);
  await server.save();
  expect(await server.evictChunk(0, 1, 0)).toBe(false);
  const restored = new GameServer({ ...server.options });
  await restored.restore();
  expect(restored.getNearbyStations('player')).toHaveLength(1);
  const chunk = persistence.loadSnapshot('0,1,0')!;
  chunk.voxels[2 + 28 * 1024] = 0;
  await persistence.saveSnapshots([chunk]);
  const broken = new GameServer({ ...server.options });
  await expect(broken.restore()).rejects.toThrow(/station/i);
});
it('rejects an orphan station voxel from a newly generated worker chunk before admission', () => {
  const server = setup();
  const canonical = new Uint16Array(32 ** 3);
  canonical[0] = 10;
  const before = server.canonicalResidencyDiagnostics.residentCount;
  expect(
    server.acceptWorkerCanonical({
      key: '2,1,0',
      cx: 2,
      cy: 1,
      cz: 0,
      chunkRevision: 0,
      generatorVersion: server.generatorVersion,
      canonical,
    }),
  ).toBe(false);
  expect(server.canonicalResidencyDiagnostics.residentCount).toBe(before);
});

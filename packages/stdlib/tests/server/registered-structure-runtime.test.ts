import { describe, expect, it, vi } from 'vitest';
import { assembleWorldPacks, definePack } from '../../src/server/composition/assembly';
import type { ModModule } from '../../src/server/composition/contracts';
import { createRegisteredOperationRuntime } from '../../src/server/composition/registered-operations';
import { GameServer } from '../../src/server/game-server';
import { EntityStore } from '../../src/server/gameplay/entity-store';
import { gameplayContentFromComposition } from '../../src/server/gameplay/modules/content-capabilities';
import { defineContentModule } from '../../src/server/gameplay/modules/content-module';
import {
  STRUCTURE_BREAK_OPERATION,
  STRUCTURE_PLACE_OPERATION,
  STRUCTURE_RESOURCE,
  STRUCTURE_TOGGLE_OPERATION,
  defineStructureActionsModuleV1,
  type StructureActionPolicyV1,
} from '../../src/server/gameplay/modules/structure-actions-module';
import {
  defineStructureDefinitionV1,
  type StructurePositionV1,
} from '../../src/server/gameplay/modules/structure-definition';
import { defineStructureDefinitionModule } from '../../src/server/gameplay/modules/structure-definition-module';
import { RegisteredStructureRuntime } from '../../src/server/gameplay/modules/registered-structure-runtime';
import { VOXEL_GEOMETRY_CAPABILITY } from '../../src/server/gameplay/modules/voxel-geometry-module';
import { WorldResourceAuthorizer } from '../../src/server/harness/world-authorization';
import { createVoxelGeometryRegistryV1 } from '../../src/world/voxel-geometry';
import { Voxel } from '../../src/world/voxel';
import { testCorePlatform } from '../support/core-platform';
import { testWorldgenExecutableProvider } from '../support/worldgen';

const orientations = ['north', 'east', 'south', 'west'] as const;
const variant = (orientation: (typeof orientations)[number], open: boolean, upper: boolean) =>
  101 + orientations.indexOf(orientation) * 4 + Number(open) * 2 + Number(upper);
const definition = defineStructureDefinitionV1({
  version: 1,
  id: 'fixture:gate',
  rootRole: 'lower',
  initialState: 'north-closed',
  parts: [
    { role: 'lower', offset: [0, 0, 0] },
    { role: 'upper', offset: [0, 1, 0] },
  ],
  states: orientations.flatMap((orientation) => [
    {
      id: `${orientation}-closed`,
      variants: { lower: variant(orientation, false, false), upper: variant(orientation, false, true) },
      collision: { lower: 'blocking' as const, upper: 'blocking' as const },
    },
    {
      id: `${orientation}-open`,
      variants: { lower: variant(orientation, true, false), upper: variant(orientation, true, true) },
      collision: { lower: 'passable' as const, upper: 'passable' as const },
    },
  ]),
  transitions: orientations.flatMap((orientation) => [
    { id: 'toggle', from: `${orientation}-closed`, to: `${orientation}-open` },
    { id: 'toggle', from: `${orientation}-open`, to: `${orientation}-closed` },
  ]),
  legacyStates: [{ stateId: 'north-closed', variants: { lower: 52, upper: 52 } }],
  support: { role: 'lower', offset: [0, -1, 0], requirement: 'solid' },
  variantDescriptorKind: 'voxel-semantics',
  placementItemId: 'fixture:gate-item',
  dropOwnerRole: 'lower',
  drop: { itemId: 'fixture:gate-item', count: 1 },
});
const policy: StructureActionPolicyV1 = Object.freeze({
  placementState: (_definition, bearing) => `${bearing}-closed`,
  toggleTransitionId: () => 'toggle',
  isReplaceable: (voxel) => voxel === Voxel.Air,
  breakToolWear: (_definition, selected) => (selected?.itemId === 'tool' ? 1 : 0),
});

function composition() {
  const values = [
    52,
    ...orientations.flatMap((orientation) => [
      variant(orientation, false, false),
      variant(orientation, false, true),
      variant(orientation, true, false),
      variant(orientation, true, true),
    ]),
  ];
  const content = defineContentModule({
    moduleId: 'fixture:content',
    items: [
      { id: 'fixture:gate-item', storageId: 'gate', name: 'Gate', stackLimit: 16 },
      { id: 'fixture:tool', storageId: 'tool', name: 'Tool', itemType: 'tool', stackLimit: 1, durability: { max: 8 } },
      { id: 'fixture:disc', storageId: 'disc', name: 'Disc', stackLimit: 1 },
    ],
    voxels: [
      {
        id: 'fixture:support',
        storageId: Voxel.Stone,
        solid: true,
        targetable: true,
        renderable: true,
        meshKind: 'cube',
        emission: 0,
        lightCost: 1,
        faceMaterials: [1, 1, 1, 1, 1, 1],
      },
      ...values.map((storageId) => ({
        id: `fixture:gate-${storageId}`,
        storageId,
        solid: storageId === 52 || (storageId - 101) % 4 < 2,
        targetable: true,
        renderable: true,
        meshKind: 'cube' as const,
        emission: 0,
        lightCost: 1,
        faceMaterials: [1, 1, 1, 1, 1, 1] as const,
      })),
    ],
    meleeDefinitions: [],
  });
  const geometryRegistry = createVoxelGeometryRegistryV1(
    values.map((voxel) => ({
      version: 1 as const,
      voxel,
      boxes: [{ min: [0, 0, 0] as const, max: [1, 1, 0.125] as const, material: 1 }],
      collision:
        voxel === 52 || (voxel - 101) % 4 < 2 ? [{ min: [0, 0, 0] as const, max: [1, 1, 0.125] as const }] : [],
      occludesFullFace: false,
    })),
  );
  const geometry: ModModule = Object.freeze({
    descriptor: {
      id: 'fixture:geometry',
      version: '1.0.0',
      provides: [{ id: VOXEL_GEOMETRY_CAPABILITY, version: '1.0.0' }],
    },
    register(api) {
      api.provideCapability(VOXEL_GEOMETRY_CAPABILITY, geometryRegistry);
    },
  });
  const structures = defineStructureDefinitionModule({ moduleId: 'fixture:structures', definitions: [definition] });
  const actions = defineStructureActionsModuleV1({ moduleId: 'fixture:structure-actions', policy });
  const pack = definePack({
    id: 'fixture:world',
    version: '1.0.0',
    kind: 'playbook',
    modules: [content, geometry, structures, actions],
  });
  const assembled = assembleWorldPacks(
    [
      {
        ...pack,
        integrity: { algorithm: 'sha256', manifestDigest: 'a'.repeat(64), entryDigest: 'b'.repeat(64), resources: [] },
      },
    ],
    { approvedPermissions: { 'fixture:world': actions.descriptor.permissions! } },
  );
  return { assembled, actions };
}

type FixtureOptions = Readonly<{
  mode?: 'survival' | 'creative';
  maxReceipts?: number;
  failRemoval?: boolean;
  failCancellation?: boolean;
  beforeWorldPrepare?(context: Readonly<{ server: GameServer; entities: EntityStore }>): void;
}>;

function fixture(options: FixtureOptions = {}) {
  const { assembled, actions } = composition();
  const content = gameplayContentFromComposition(assembled);
  const server = new GameServer({
    seedText: 'b2-structure',
    platform: testCorePlatform,
    worldgenProvider: testWorldgenExecutableProvider,
    composition: assembled,
  });
  server.edit(1, 30, 0, Voxel.Stone);
  server.edit(1, 31, 0, Voxel.Air);
  server.edit(1, 32, 0, Voxel.Air);
  const entities = new EntityStore(content.items);
  entities.spawn({ id: 'alice', type: 'player', position: [1.5, 31, 3.5] });
  const actor = entities.playerStateAccess('alice');
  if (options.mode === 'creative') {
    actor.replaceModeComponents({
      mode: { version: 1, value: 'creative', revision: 1 },
      creativeCatalog: {
        version: 1,
        revision: 1,
        selectedSlot: 0,
        hotbar: ['gate', ...Array.from({ length: 7 }, () => null)],
      },
      flight: { version: 1, enabled: false, revision: 0 },
    });
  } else actor.inventory.add({ itemId: 'gate', count: 2 });
  let gameplayRevision = 0;
  let removalApplyCount = 0;
  let cancellationApplyCount = 0;
  const removalPrepare = vi.fn((_position: StructurePositionV1) => {
    let validated = false;
    return {
      removed: true,
      ejectedItem: null,
      validate() {
        if (options.failRemoval && removalPrepare.mock.calls.length === 2) throw new Error('dependent-removal-failure');
        validated = true;
      },
      apply() {
        if (!validated) throw new Error('dependent removal requires validation');
        removalApplyCount += 1;
      },
    };
  });
  const runtime = new RegisteredStructureRuntime({
    composition: assembled,
    entities,
    readCell(position) {
      const cell = server.peekLoadedVoxel(...position);
      if (!cell) return null;
      const fluid = server.getFluidCell(...position);
      return { voxel: cell.voxel, fluid: fluid ? fluid.level | (fluid.source ? 0x80 : 0) : 0 };
    },
    prepareVoxelEdits: (actorId, edits) => {
      options.beforeWorldPrepare?.({ server, entities });
      return server.prepareVoxelEdits(actorId, edits);
    },
    gameplayRevision: () => gameplayRevision,
    worldRevision: () => server.worldRevision,
    prepareGameplayChange: (_inventoryChanged, precedingWorldCommit) => {
      const previous = gameplayRevision;
      if (precedingWorldCommit.worldRevision !== server.worldRevision + 1)
        throw new Error('prepared world/gameplay revision mismatch');
      if (previous >= Number.MAX_SAFE_INTEGER) throw new RangeError('gameplay revision exhausted');
      let validated = false;
      return {
        revision: previous + 1,
        validate() {
          if (gameplayRevision !== previous) throw new Error('gameplay revision stale');
          validated = true;
        },
        apply() {
          if (!validated) throw new Error('gameplay revision requires validation');
          gameplayRevision = previous + 1;
        },
      };
    },
    prepareCancellation: () => {
      let validated = false;
      return {
        validate() {
          if (options.failCancellation) throw new Error('cancellation-failure');
          validated = true;
        },
        apply() {
          if (!validated) throw new Error('cancellation requires validation');
          cancellationApplyCount += 1;
        },
      };
    },
    prepareDependentRemoval: removalPrepare,
    ...(options.maxReceipts ? { maxReceipts: options.maxReceipts } : {}),
  });
  const authorizer = new WorldResourceAuthorizer(
    {
      principals: [{ id: 'human', boundEntityId: 'alice' }],
      rules: [
        {
          effect: 'allow',
          principal: { ids: ['human'] },
          resources: [STRUCTURE_RESOURCE],
          operations: ['read', 'execute'],
          scope: 'any',
        },
      ],
    },
    assembled.resources,
  );
  const operations = createRegisteredOperationRuntime({
    composition: assembled,
    authorizer,
    clone: structuredClone,
    state: runtime.state,
  });
  const execution = operations.bind({
    moduleId: actions.descriptor.id,
    principalId: 'human',
    originalActorId: 'alice',
  });
  const invoke = (kind: 'place' | 'toggle' | 'break', hit: StructurePositionV1, adjacent: StructurePositionV1) =>
    execution.invoke({
      operationId:
        kind === 'place'
          ? STRUCTURE_PLACE_OPERATION
          : kind === 'toggle'
            ? STRUCTURE_TOGGLE_OPERATION
            : STRUCTURE_BREAK_OPERATION,
      target: { kind: 'voxel', position: kind === 'place' ? adjacent : hit },
      input: { hit, adjacent },
    });
  return {
    server,
    entities,
    actor,
    runtime,
    invoke,
    gameplayRevision: () => gameplayRevision,
    removalPrepare,
    removalApplyCount: () => removalApplyCount,
    cancellationApplyCount: () => cancellationApplyCount,
  };
}

const place = (
  world: ReturnType<typeof fixture>,
  hit: StructurePositionV1 = [1, 30, 0],
  adjacent: StructurePositionV1 = [1, 31, 0],
) => world.invoke('place', hit, adjacent);

describe('registered Structure runtime with real world and entity owners', () => {
  it.each([
    ['north', [1, 31, 1], [1, 31, 0]],
    ['east', [0, 31, 0], [1, 31, 0]],
    ['south', [1, 31, -1], [1, 31, 0]],
    ['west', [2, 31, 0], [1, 31, 0]],
  ] as const)(
    'places a cross-Chunk %s state with one world/gameplay/inventory advance',
    (orientation, hit, adjacent) => {
      const world = fixture();
      if (adjacent[1] !== 31) throw new Error('invalid fixture');
      const beforeWorld = world.server.worldRevision;
      const beforeGameplay = world.gameplayRevision();
      const beforeInventory = world.actor.inventoryRevision;
      const lowerChunk = world.server.getChunk(0, 0, 0);
      const upperChunk = world.server.getChunk(0, 1, 0);
      const lowerRevision = lowerChunk.revision;
      const upperRevision = upperChunk.revision;

      const result = place(world, hit, adjacent);

      expect(result).toMatchObject({ ok: true, value: { kind: 'place', definitionId: 'fixture:gate' } });
      expect(world.server.getVoxel(1, 31, 0)).toBe(variant(orientation, false, false));
      expect(world.server.getVoxel(1, 32, 0)).toBe(variant(orientation, false, true));
      expect(world.server.worldRevision).toBe(beforeWorld + 1);
      expect(world.gameplayRevision()).toBe(beforeGameplay + 1);
      expect(world.actor.inventoryRevision).toBe(beforeInventory + 1);
      expect(lowerChunk.revision).toBe(lowerRevision + 1);
      expect(upperChunk.revision).toBe(upperRevision + 1);
      expect(world.actor.inventory.slot(0)).toEqual({ itemId: 'gate', count: 1 });
      expect(world.cancellationApplyCount()).toBe(1);
      expect(world.runtime.takeCommits()).toHaveLength(1);
    },
  );

  it('places from the creative catalog without consuming or producing inventory', () => {
    const world = fixture({ mode: 'creative' });
    const slots = world.actor.inventory.snapshot();
    const revision = world.actor.inventoryRevision;

    expect(place(world)).toMatchObject({ ok: true, value: { kind: 'place' } });
    expect(world.actor.inventory.snapshot()).toEqual(slots);
    expect(world.actor.inventoryRevision).toBe(revision);
    expect(world.entities.query({ type: 'world-item' })).toEqual([]);
    expect(world.cancellationApplyCount()).toBe(0);
    expect(world.invoke('break', [1, 32, 0], [2, 32, 0])).toMatchObject({ ok: true, value: { kind: 'break' } });
    expect(world.entities.query({ type: 'world-item' })).toEqual([]);
  });

  it.each([
    ['lower', [1, 31, 0] as const],
    ['upper', [1, 32, 0] as const],
  ])('toggles and breaks from the %s half with one survival drop and tool wear', (_role, selected) => {
    const world = fixture();
    expect(place(world)).toMatchObject({ ok: true });
    world.actor.breakAction = {
      position: [1, 31, 0],
      voxel: variant('north', false, false),
      elapsedSeconds: 0,
      requiredSeconds: 1,
    };
    expect(world.invoke('toggle', selected, [2, selected[1], 0])).toMatchObject({
      ok: true,
      value: { kind: 'toggle' },
    });
    expect(world.actor.breakAction).toBeNull();
    expect(world.server.getVoxel(1, 31, 0)).toBe(variant('north', true, false));
    expect(world.server.getVoxel(1, 32, 0)).toBe(variant('north', true, true));
    world.actor.inventory.replace([
      { itemId: 'tool', count: 1, instance: { durability: 8 } },
      ...Array.from({ length: world.actor.inventory.capacity - 1 }, () => null),
    ]);
    const beforeWorld = world.server.worldRevision;

    expect(world.invoke('break', selected, [2, selected[1], 0])).toMatchObject({
      ok: true,
      value: { kind: 'break' },
    });
    expect(world.server.getVoxel(1, 31, 0)).toBe(Voxel.Air);
    expect(world.server.getVoxel(1, 32, 0)).toBe(Voxel.Air);
    expect(world.server.worldRevision).toBe(beforeWorld + 1);
    expect(world.actor.inventory.slot(0)).toEqual({ itemId: 'tool', count: 1, instance: { durability: 7 } });
    expect(world.entities.query({ type: 'world-item' }).map((entity) => entity.stack)).toEqual([
      { itemId: 'gate', count: 1 },
    ]);
    expect(world.removalPrepare).toHaveBeenCalledTimes(2);
    expect(world.removalApplyCount()).toBe(2);
    expect(world.cancellationApplyCount()).toBe(3);
  });

  it('migrates a valid legacy pair on toggle and rejects dependent participant failure without writes', () => {
    const legacy = fixture();
    legacy.server.edit(1, 31, 0, 52);
    legacy.server.edit(1, 32, 0, 52);
    expect(legacy.invoke('toggle', [1, 32, 0], [2, 32, 0])).toMatchObject({ ok: true });
    expect(legacy.server.getVoxel(1, 31, 0)).toBe(variant('north', true, false));
    expect(legacy.server.getVoxel(1, 32, 0)).toBe(variant('north', true, true));

    const failed = fixture({ failRemoval: true });
    expect(place(failed)).toMatchObject({ ok: true });
    failed.runtime.takeCommits();
    const before = {
      world: failed.server.worldRevision,
      gameplay: failed.gameplayRevision(),
      inventory: failed.actor.inventoryRevision,
      slots: failed.actor.inventory.snapshot(),
      entities: failed.entities.query(),
      lower: failed.server.getVoxel(1, 31, 0),
      upper: failed.server.getVoxel(1, 32, 0),
    };
    expect(failed.invoke('break', [1, 31, 0], [2, 31, 0])).toMatchObject({
      ok: false,
      message: 'dependent-removal-failure',
    });
    expect({
      world: failed.server.worldRevision,
      gameplay: failed.gameplayRevision(),
      inventory: failed.actor.inventoryRevision,
      slots: failed.actor.inventory.snapshot(),
      entities: failed.entities.query(),
      lower: failed.server.getVoxel(1, 31, 0),
      upper: failed.server.getVoxel(1, 32, 0),
    }).toEqual(before);
    expect(failed.removalApplyCount()).toBe(0);
    expect(failed.runtime.takeCommits()).toEqual([]);
  });

  it('rejects cancellation and receipt capacity failures before any owner applies', () => {
    const cancellation = fixture({ failCancellation: true });
    const cancelBefore = [
      cancellation.server.worldRevision,
      cancellation.actor.inventoryRevision,
      cancellation.gameplayRevision(),
    ];
    expect(place(cancellation)).toMatchObject({ ok: false, message: 'cancellation-failure' });
    expect([
      cancellation.server.worldRevision,
      cancellation.actor.inventoryRevision,
      cancellation.gameplayRevision(),
    ]).toEqual(cancelBefore);
    expect(cancellation.server.getVoxel(1, 31, 0)).toBe(Voxel.Air);

    const capacity = fixture({ maxReceipts: 1 });
    expect(place(capacity)).toMatchObject({ ok: true });
    const before = [capacity.server.worldRevision, capacity.gameplayRevision()];
    expect(capacity.invoke('toggle', [1, 31, 0], [2, 31, 0])).toMatchObject({
      ok: false,
      message: 'Structure commit receipt capacity exhausted.',
    });
    expect([capacity.server.worldRevision, capacity.gameplayRevision()]).toEqual(before);
    expect(capacity.server.getVoxel(1, 31, 0)).toBe(variant('north', false, false));
  });

  it.each(['selection', 'lifetime'] as const)('rejects stale actor %s before preparing world writes', (fault) => {
    const world = fixture({
      beforeWorldPrepare({ entities }) {
        if (fault === 'selection') entities.playerStateAccess('alice').selectedSlot = 1;
        else {
          entities.despawn('alice');
          entities.spawn({ id: 'alice', type: 'player', position: [1.5, 31, 3.5] });
        }
      },
    });
    const beforeWorld = world.server.worldRevision;

    expect(place(world)).toMatchObject({ ok: false });
    expect(world.server.worldRevision).toBe(beforeWorld);
    expect(world.server.getVoxel(1, 31, 0)).toBe(Voxel.Air);
    expect(world.server.getVoxel(1, 32, 0)).toBe(Voxel.Air);
    expect(world.runtime.takeCommits()).toEqual([]);
  });

  it('rejects isolated or ambiguous legacy footprints and a stale world without partial Structure writes', () => {
    const isolated = fixture();
    isolated.server.edit(1, 31, 0, 52);
    expect(isolated.invoke('toggle', [1, 31, 0], [2, 31, 0])).toMatchObject({ ok: false });
    expect(isolated.server.getVoxel(1, 31, 0)).toBe(52);
    expect(isolated.server.getVoxel(1, 32, 0)).toBe(Voxel.Air);
    const ambiguous = fixture();
    ambiguous.server.edit(1, 31, 0, 52);
    ambiguous.server.edit(1, 32, 0, 52);
    ambiguous.server.edit(1, 33, 0, 52);
    expect(ambiguous.invoke('toggle', [1, 32, 0], [2, 32, 0])).toMatchObject({ ok: false });
    expect([31, 32, 33].map((y) => ambiguous.server.getVoxel(1, y, 0))).toEqual([52, 52, 52]);

    const stale = fixture({ beforeWorldPrepare: ({ server }) => void server.edit(4, 31, 0, Voxel.Stone) });
    const before = stale.server.worldRevision;
    expect(place(stale)).toMatchObject({ ok: false });
    expect(stale.server.worldRevision).toBe(before + 1);
    expect(stale.server.getVoxel(1, 31, 0)).toBe(Voxel.Air);
    expect(stale.server.getVoxel(1, 32, 0)).toBe(Voxel.Air);
    expect(stale.actor.inventory.slot(0)).toEqual({ itemId: 'gate', count: 2 });
    expect(stale.runtime.takeCommits()).toEqual([]);
  });

  it.each(['range', 'line-of-sight'] as const)('revalidates %s before preparing a Structure change', (fault) => {
    const world = fixture();
    if (fault === 'range') world.entities.update('alice', { position: [100, 31, 100] });
    else world.server.edit(1, 31, 2, Voxel.Stone);
    const before = world.server.worldRevision;

    expect(place(world)).toMatchObject({ ok: false });
    expect(world.server.worldRevision).toBe(before);
    expect(world.server.getVoxel(1, 31, 0)).toBe(Voxel.Air);
    expect(world.server.getVoxel(1, 32, 0)).toBe(Voxel.Air);
    expect(world.actor.inventory.slot(0)).toEqual({ itemId: 'gate', count: 2 });
  });
});

import { expect, it } from 'vitest';
import { defineContentModule, definePack, defineStationActionsModule } from '@seedlands/game-core/mod-api';
import { assembleWorldPacks, createGameplaySystemAuthority } from '@seedlands/game-core/server/composition/host-api';
import { GameplayRuntime } from '../../../packages/game-core/src/server/gameplay/gameplay-runtime';
import { WorldResourceAuthorizer } from '../../../packages/game-core/src/server/harness/world-authorization';
import { testCorePlatform } from '../../support/core-platform';
function setup(denied = false, hook?: (value: unknown) => void) {
  const modules = [
    defineContentModule({
      moduleId: 'test:content',
      items: [{ id: 'test:wood', name: 'Wood', itemType: 'resource', stackLimit: 64, capabilities: [] }],
      meleeDefinitions: [],
      stations: {
        definitions: [
          { kind: 'workbench', voxel: 11 },
          { kind: 'furnace', voxel: 13 },
        ],
        recipes: [
          {
            kind: 'shapeless',
            id: 'test:craft',
            inputs: [{ itemId: 'test:wood', count: 2 }],
            outputs: [{ itemId: 'test:wood', count: 1 }],
          },
        ],
        furnaceRecipes: [
          {
            id: 'test:smelt',
            input: { itemId: 'test:wood', count: 1 },
            output: { itemId: 'test:wood', count: 1 },
            durationSeconds: 1,
          },
        ],
        fuels: [{ itemId: 'test:wood', burnSeconds: 2 }],
      },
    }),
    defineStationActionsModule(),
  ];
  const pack = definePack({ id: 'test:station', kind: 'playbook', version: '1.0.0', modules });
  const composition = assembleWorldPacks(
    [
      {
        ...pack,
        integrity: { algorithm: 'sha256', manifestDigest: 'a'.repeat(64), entryDigest: 'b'.repeat(64), resources: [] },
      },
    ],
    { approvedPermissions: { 'test:station': modules.flatMap((module) => module.descriptor.permissions ?? []) } },
  );
  const runtime = new GameplayRuntime({
    composition,
    moduleSystemAuthority: createGameplaySystemAuthority(composition),
    platform: {
      ...testCorePlatform,
      clone: <T>(value: T): T => {
        hook?.(value);
        return structuredClone(value);
      },
    },
    getVoxel: ([x, y, z]) => (x === 2 && y === 0 && z === 0 ? 11 : x === 2 && y === 0 && z === 1 ? 13 : 0),
    getWorldTime: () => 9,
    prepareVoxelEdit: () => ({ committed: false }) as never,
  });
  runtime.spawnPlayer({ id: 'player', position: [0.5, 0, 0.5] });
  runtime.giveItem('player', { itemId: 'test:wood', count: 4 });
  runtime.entities.spawn({ id: 'workbench', type: 'station', position: [2, 0, 0], station: { kind: 'workbench' } });
  const authorizer = new WorldResourceAuthorizer(
    {
      principals: [{ id: 'human', kind: 'actor', subject: 'test:human', boundEntityId: 'player' }],
      rules: [
        { effect: 'allow', resources: ['*'], operations: ['*'], scope: 'any' },
        ...(denied
          ? [
              {
                effect: 'deny' as const,
                resources: ['seedlands.station-actor'],
                operations: ['execute' as const],
                scope: 'any' as const,
              },
            ]
          : []),
      ],
    },
    composition.resources,
  );
  const binding = runtime.bindModuleOperations(authorizer, {
    moduleId: 'seedlands:station-actions-module',
    principalId: 'human',
    originalActorId: 'player',
  });
  const transfer = (revision = 0) =>
    binding.invoke({
      operationId: 'seedlands:station-transfer',
      target: { kind: 'entity', entityId: 'workbench' },
      input: { expectedStationRevision: revision, from: 'actor', actorSlot: 0, stationSlot: 0, count: 2 },
    });
  return { runtime, binding, transfer };
}
it('commits actor and station once, rejects duplicate retry, and crafts into actor inventory', () => {
  const { runtime, binding, transfer } = setup();
  expect(transfer()).toMatchObject({ ok: true, value: { stationRevision: 1 } });
  expect(runtime.getInventory('player').slots[0]?.count).toBe(2);
  expect(runtime.entities.stationSnapshot('workbench')).toMatchObject({
    revision: 1,
    grid: [{ itemId: 'test:wood', count: 2 }, ...Array(8).fill(null)],
  });
  const before = runtime.createSnapshot();
  expect(transfer().ok).toBe(false);
  expect(runtime.createSnapshot()).toEqual(before);
  expect(
    binding.invoke({
      operationId: 'seedlands:station-craft',
      target: { kind: 'entity', entityId: 'workbench' },
      input: { expectedStationRevision: 1, recipeId: 'test:craft' },
    }),
  ).toMatchObject({ ok: true, value: { stationRevision: 2 } });
  expect(runtime.getInventory('player').slots[0]?.count).toBe(3);
  binding.dispose();
  runtime.entities.dispose();
});
it('denied secondary actor execute and final result clone failure leave both owners untouched', () => {
  const denied = setup(true),
    before = denied.runtime.createSnapshot();
  expect(denied.transfer().ok).toBe(false);
  expect(denied.runtime.createSnapshot()).toEqual(before);
  denied.binding.dispose();
  denied.runtime.entities.dispose();
  let fail = false;
  const setupFailure = setup(false, (value) => {
    if (fail && value && typeof value === 'object' && 'success' in value && 'stationRevision' in value)
      throw new Error('fixture-final-clone');
  });
  const snapshot = setupFailure.runtime.createSnapshot();
  fail = true;
  expect(setupFailure.transfer().ok).toBe(false);
  fail = false;
  expect(setupFailure.runtime.createSnapshot()).toEqual(snapshot);
  setupFailure.binding.dispose();
  setupFailure.runtime.entities.dispose();
});

it('advances real furnace by logical time and resumes its same checkpoint exactly once', () => {
  const first = setup();
  first.runtime.entities.spawn({ id: 'furnace', type: 'station', position: [2, 0, 1], station: { kind: 'furnace' } });
  for (const [revision, slot] of [
    [0, 0],
    [1, 1],
  ])
    expect(
      first.binding.invoke({
        operationId: 'seedlands:station-transfer',
        target: { kind: 'entity', entityId: 'furnace' },
        input: { expectedStationRevision: revision, from: 'actor', actorSlot: 0, stationSlot: slot, count: 1 },
      }),
    ).toMatchObject({ ok: true });
  first.runtime.advanceRules(0.5);
  expect(first.runtime.entities.stationSnapshot('furnace')).toMatchObject({
    furnace: { progressSeconds: 0.5, remainingFuelSeconds: 1.5, output: null },
  });
  const saved = first.runtime.createSnapshot();
  const second = setup();
  second.runtime.restoreSnapshot(saved);
  first.runtime.advanceRules(0.5);
  second.runtime.advanceRules(0.5);
  expect(second.runtime.createSnapshot()).toEqual(first.runtime.createSnapshot());
  expect(second.runtime.entities.stationSnapshot('furnace')).toMatchObject({
    furnace: { input: null, progressSeconds: 0, output: { itemId: 'test:wood', count: 1 } },
  });
  second.runtime.advanceRules(1);
  expect(second.runtime.entities.stationSnapshot('furnace')).toMatchObject({
    furnace: { output: { itemId: 'test:wood', count: 1 } },
  });
  first.binding.dispose();
  second.binding.dispose();
  first.runtime.dispose();
  second.runtime.dispose();
  first.runtime.entities.dispose();
  second.runtime.entities.dispose();
});

it('keeps blocked furnace contents, progress, fuel and station revision unchanged', () => {
  const first = setup();
  first.runtime.entities.spawn({ id: 'furnace', type: 'station', position: [2, 0, 1], station: { kind: 'furnace' } });
  const snapshot = first.runtime.createSnapshot(),
    owner = snapshot.entityStore;
  if (owner.version !== 2) throw new Error('Expected V2');
  owner.stations = owner.stations.map((station) =>
    station.kind === 'furnace'
      ? {
          ...station,
          furnace: {
            version: 1,
            input: { itemId: 'test:wood', count: 1 },
            fuel: { itemId: 'test:wood', count: 1 },
            output: { itemId: 'test:wood', count: 64 },
            activeRecipeId: null,
            remainingFuelSeconds: 0,
            progressSeconds: 0,
          },
        }
      : station,
  );
  first.runtime.restoreSnapshot(snapshot);
  const before = first.runtime.entities.stationSnapshot('furnace');
  first.runtime.advanceRules(1);
  expect(first.runtime.entities.stationSnapshot('furnace')).toEqual(before);
  expect(first.runtime.gameplayTime).toBe(1);
  first.runtime.dispose();
  first.runtime.entities.dispose();
});

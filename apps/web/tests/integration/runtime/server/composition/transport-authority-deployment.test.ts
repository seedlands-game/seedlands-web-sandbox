import { expect, it, vi } from 'vitest';
import {
  defineContentModule,
  defineItemInteractionModule,
  definePack,
  defineRouteDefinitionV1,
  defineTransportInteractionModule,
  type ModModule,
  type ModuleInvocationValue,
  type ModulePermission,
} from '@seedlands/stdlib/mod-api';
import {
  assembleWorldPacks,
  createGameplayActorAuthority,
  createGameplaySystemAuthority,
  worldgenProviderForComposition,
  type VerifiedPackArtifact,
} from '@seedlands/stdlib/host';
import { AuthorityRuntime } from '../../../../../../../packages/stdlib/src/server/authority/authority-runtime';
import type { EntityStoreComponentSnapshotV2 } from '../../../../../../../packages/stdlib/src/server/gameplay/entity-store';
import type { GameplaySnapshotV4 } from '../../../../../../../packages/stdlib/src/server/gameplay/gameplay-runtime';
import type { AuthorityAction } from '../../../../../../../packages/stdlib/src/server/protocol/authority-worker-protocol';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';
import { buildingModules } from '../../../../fixtures/packs/builder/building-content';
import { TRANSPORT_DEPLOYMENT_COMPONENT } from '../../../../../../../packages/stdlib/src/server/gameplay/modules/transport-interaction-config';
import { MemoryGamePersistence } from '../../../../../../../packages/stdlib/src/server/persistence/memory-game-persistence';

type Runtime = Awaited<ReturnType<typeof create>>;

const modules = [
  ...buildingModules(false).filter((module) => module.descriptor.id !== 'sample:building-content'),
  defineContentModule({
    moduleId: 'sample:building-content',
    voxels: [
      {
        id: 'sample:air',
        storageId: 0,
        solid: false,
        targetable: false,
        renderable: false,
        meshKind: 'cube',
        emission: 0,
        lightCost: 1,
        faceMaterials: [4, 4, 4, 4, 4, 4],
      },
      {
        id: 'sample:stone-voxel',
        storageId: 3,
        solid: true,
        targetable: true,
        renderable: true,
        meshKind: 'cube',
        emission: 0,
        lightCost: 16,
        faceMaterials: [4, 4, 4, 4, 4, 4],
      },
      {
        id: 'sample:wood-voxel',
        storageId: 4,
        solid: true,
        targetable: true,
        renderable: true,
        meshKind: 'cube',
        emission: 0,
        lightCost: 16,
        faceMaterials: [4, 4, 4, 4, 4, 4],
      },
      {
        id: 'sample:platform-voxel',
        storageId: 5,
        solid: true,
        targetable: true,
        renderable: true,
        meshKind: 'cube',
        emission: 0,
        lightCost: 16,
        faceMaterials: [4, 4, 4, 4, 4, 4],
      },
      {
        id: 'sample:rail-marker-voxel',
        storageId: 6,
        solid: false,
        targetable: true,
        renderable: true,
        meshKind: 'cube',
        emission: 0,
        lightCost: 1,
        faceMaterials: [4, 4, 4, 4, 4, 4],
      },
    ],
    items: [
      {
        id: 'sample:wood',
        storageId: 'sample:wood',
        name: 'Wood block',
        itemType: 'block',
        stackLimit: 64,
        capabilities: [{ type: 'place', voxel: 4 }],
      },
      {
        id: 'sample:stone',
        storageId: 'sample:stone',
        name: 'Stone block',
        itemType: 'block',
        stackLimit: 64,
        capabilities: [{ type: 'place', voxel: 3 }],
      },
      { id: 'sample:route-cart-kit', name: 'Route cart kit', itemType: 'resource', stackLimit: 8, capabilities: [] },
      {
        id: 'sample:surface-cart-kit',
        name: 'Surface cart kit',
        itemType: 'resource',
        stackLimit: 8,
        capabilities: [],
      },
    ],
    recipes: [],
    meleeDefinitions: [],
  }),
  defineTransportInteractionModule({
    moduleId: 'sample:transport-deployments',
    operationId: 'sample:deploy-transport',
    definitions: [
      {
        version: 1,
        id: 'sample:route-cart',
        locomotion: { provider: 'route', providerId: 'sample:rail' },
        bodyAabb: { min: { x: -0.4, y: 0, z: -0.4 }, max: { x: 0.4, y: 0.8, z: 0.4 } },
        seatOffset: [0, 0.55, 0],
        fuelCapacity: 20,
        inventoryCapacity: 1,
        presentationId: 'sample:route-cart-model',
      },
      {
        version: 1,
        id: 'sample:surface-cart',
        locomotion: { provider: 'surface', providerId: 'sample:ground' },
        bodyAabb: { min: { x: -0.4, y: 0, z: -0.4 }, max: { x: 0.4, y: 0.8, z: 0.4 } },
        seatOffset: [0, 0.55, 0],
        fuelCapacity: 20,
        inventoryCapacity: 1,
        presentationId: 'sample:surface-cart-model',
      },
    ],
    deployments: [
      { itemId: 'sample:route-cart-kit', definitionId: 'sample:route-cart' },
      { itemId: 'sample:surface-cart-kit', definitionId: 'sample:surface-cart' },
    ],
    routes: [
      {
        definition: defineRouteDefinitionV1({
          version: 1,
          family: 'sample:rail',
          variants: [
            {
              variant: 'sample:straight',
              edges: [
                {
                  entry: { side: 'west', elevation: 0 },
                  exit: { side: 'east', elevation: 0 },
                  curve: 'line',
                  slopeDelta: 0,
                },
                {
                  entry: { side: 'east', elevation: 0 },
                  exit: { side: 'west', elevation: 0 },
                  curve: 'line',
                  slopeDelta: 0,
                },
              ],
            },
          ],
        }),
        voxels: [6],
      },
    ],
    surfaces: [{ id: 'sample:ground', voxels: [5], surfaceOffset: 1 }],
  }),
  defineItemInteractionModule({
    moduleId: 'sample:transport-deployment-bindings',
    permissions: [{ resource: 'seedlands.transport', operations: ['execute'] }],
    definitions: [
      {
        id: 'sample:route-cart-binding',
        selector: { itemId: 'sample:route-cart-kit' },
        trigger: 'voxel',
        operationId: 'sample:deploy-transport',
        presentationKey: 'sample:route-cart-deploy',
      },
      {
        id: 'sample:surface-cart-binding',
        selector: { itemId: 'sample:surface-cart-kit' },
        trigger: 'voxel',
        operationId: 'sample:deploy-transport',
        presentationKey: 'sample:surface-cart-deploy',
      },
    ],
  }),
];

type RuleMode = 'veto' | 'forge';
const registeredRuleModule = (mode: RuleMode): ModModule => ({
  descriptor: {
    id: `test:transport-${mode}-rule`,
    version: '1.0.0',
    permissions: [{ resource: 'seedlands.transport', operations: ['read', 'write', 'execute'] }],
  },
  register(api) {
    api.registerRule({
      id: `test:transport-${mode}`,
      operationId: 'sample:deploy-transport',
      stage: 'after',
      apply(context, _input, state, candidate) {
        if (context.kind !== 'actor') throw new TypeError('Expected a transport actor rule context.');
        if (mode === 'veto') return { reject: 'transport-test-veto' };
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate) || !('deployment' in candidate))
          throw new TypeError('Expected the registered transport candidate.');
        const value = candidate as Record<string, unknown>;
        const deployment = value.deployment;
        if (!deployment || typeof deployment !== 'object' || Array.isArray(deployment))
          throw new TypeError('Expected a transport deployment candidate.');
        state.write(
          {
            componentId: TRANSPORT_DEPLOYMENT_COMPONENT,
            target: { kind: 'entity', entityId: context.originalActorId },
          },
          {
            ...value,
            deployment: { ...(deployment as Record<string, unknown>), position: [20, 59, 0] },
          } as ModuleInvocationValue,
        );
      },
    });
  },
});
const requestedPermissions = (registeredModules: readonly ModModule[]): readonly ModulePermission[] => {
  const merged = new Map<string, Set<ModulePermission['operations'][number]>>();
  for (const module of registeredModules) {
    for (const permission of module.descriptor.permissions ?? []) {
      const operations = merged.get(permission.resource) ?? new Set<ModulePermission['operations'][number]>();
      for (const operation of permission.operations) operations.add(operation);
      merged.set(permission.resource, operations);
    }
  }
  const transportOperations = merged.get('seedlands.transport') ?? new Set<ModulePermission['operations'][number]>();
  for (const operation of ['read', 'write', 'execute'] as const) transportOperations.add(operation);
  merged.set('seedlands.transport', transportOperations);
  return Object.freeze(
    Array.from(merged, ([resource, operations]) =>
      Object.freeze({ resource, operations: Object.freeze([...operations]) }),
    ),
  );
};
const composition = (ruleMode?: RuleMode) => {
  const registeredModules = ruleMode ? [...modules, registeredRuleModule(ruleMode)] : modules;
  const candidate = definePack({
    id: 'sample:transport-world',
    version: '1.0.0',
    kind: 'playbook',
    modules: registeredModules,
  });
  const verified: VerifiedPackArtifact = {
    ...candidate,
    integrity: { algorithm: 'sha256', manifestDigest: 'a'.repeat(64), entryDigest: 'b'.repeat(64), resources: [] },
  };
  return assembleWorldPacks([verified], {
    approvedPermissions: { 'sample:transport-world': requestedPermissions(registeredModules) },
  });
};
const create = async (ruleMode?: RuleMode, persistence?: MemoryGamePersistence) => {
  const world = composition(ruleMode);
  return AuthorityRuntime.create({
    epoch: 'transport-authority-deployment',
    seedText: 'transport-authority-deployment',
    platform: testCorePlatform,
    composition: world,
    moduleActorAuthority: createGameplayActorAuthority(world.resources, { playerAlias: 'transport-player' }),
    moduleSystemAuthority: createGameplaySystemAuthority(world),
    worldgenProvider: worldgenProviderForComposition(world),
    initialWorldTime: 8,
    startTimeMs: 0,
    initialPlayerBodyPosition: [0.5, 60, 0.5],
    ...(persistence ? { persistence } : {}),
  });
};
const isPortableTransportCheckpoint = (
  checkpoint: ReturnType<AuthorityRuntime['exportPortableCheckpoint']>,
): checkpoint is ReturnType<AuthorityRuntime['exportPortableCheckpoint']> & {
  gameplay: GameplaySnapshotV4 & { entityStore: EntityStoreComponentSnapshotV2 };
} => checkpoint.gameplay.version === 4 && checkpoint.gameplay.entityStore.version === 2;

const selection = (runtime: Runtime) => {
  const player = runtime.server.getPlayerState(runtime.playerId);
  return {
    inventoryRevision: runtime.server.getInventoryPointerView(runtime.playerId).revision,
    modeRevision: player.mode!.revision,
    creativeCatalogRevision: player.creativeCatalog!.revision,
    selectedSlot: player.selectedSlot,
  };
};

const deploy = (
  runtime: Runtime,
  hit: readonly [number, number, number],
  adjacent: readonly [number, number, number],
  expectedSelection = selection(runtime),
): AuthorityAction => ({
  type: 'interact',
  intent: 'use',
  target: { kind: 'voxel', hit: [...hit], adjacent: [...adjacent] },
  expectedSelection,
});

const putVoxel = async (runtime: Runtime, position: readonly [number, number, number], value: number) => {
  const committed = await runtime.editWorld('transport-deployment-fixture', [
    { x: position[0], y: position[1], z: position[2], value },
  ]);
  expect(committed).toMatchObject({ committed: true });
};

const addRoute = async (runtime: Runtime) => {
  const committed = await runtime.editWorld(
    'transport-deployment-route-fixture',
    [0, 1, 2].map((x) => ({
      x,
      y: 59,
      z: 0,
      value: 6,
    })),
  );
  expect(committed).toMatchObject({ committed: true });
};

const state = (runtime: Runtime) => ({
  authoritySnapshot: runtime.snapshot(),
  inventory: runtime.server.getInventoryPointerView(runtime.playerId),
  gameplayRevision: runtime.server.gameplayRevision,
  worldRevision: runtime.server.worldRevision,
  commitSequence: runtime.server.commitSequence,
  entities: runtime.view().entities,
  transports: Reflect.get(runtime.view(), 'transports'),
});

it('deploys route and surface transports through a selected item in the real Authority action path', async () => {
  const runtime = await create();
  await addRoute(runtime);
  await putVoxel(runtime, [3, 59, 0], 5);
  expect(runtime.server.getVoxel(1, 59, 0)).toBe(6);
  expect(runtime.server.getVoxel(1, 60, 0)).toBe(0);
  expect(runtime.server.getVoxel(3, 59, 0)).toBe(5);
  expect(runtime.server.getVoxel(3, 60, 0)).toBe(0);
  runtime.server.giveItem(runtime.playerId, { itemId: 'sample:route-cart-kit', count: 1 });
  runtime.takeCommits();
  const beforeRoute = runtime.server.getInventoryPointerView(runtime.playerId);
  const operationSpy = vi.spyOn(runtime.server, 'invokeActorModuleOperation');

  const routeResult = await runtime.performAction(deploy(runtime, [1, 59, 0], [1, 60, 0]));
  const registeredResult = operationSpy.mock.results[0]?.value;

  expect(operationSpy).toHaveBeenCalledTimes(1);
  expect(
    routeResult.result,
    `${JSON.stringify(routeResult.result)}; registered=${JSON.stringify(registeredResult)}`,
  ).toMatchObject({
    success: true,
    handled: true,
    bindingId: 'sample:route-cart-binding',
  });
  expect(runtime.server.getInventoryPointerView(runtime.playerId).slots[0]).toBeNull();
  expect(runtime.server.getInventoryPointerView(runtime.playerId).revision).toBe(beforeRoute.revision + 1);
  const routeView = runtime.view();
  const routeEntity = routeView.entities.find((entity) => entity.type === 'transport');
  expect(routeEntity).toBeDefined();
  expect(routeEntity).toMatchObject({ type: 'transport', position: [1.5, 59, 0.5] });
  expect(routeView.transports).toHaveLength(1);
  expect(routeView.transports?.[0]).toMatchObject({
    reference: runtime.server.createEntityReference(routeEntity!.id),
    definitionId: 'sample:route-cart',
    pose: { position: [1.5, 59, 0.5] },
  });

  runtime.server.giveItem(runtime.playerId, { itemId: 'sample:surface-cart-kit', count: 1 });
  await runtime.performAction({ type: 'select-hotbar', slot: 0 });
  const surfaceBefore = runtime.server.getInventoryPointerView(runtime.playerId);
  const surfaceResult = await runtime.performAction(deploy(runtime, [3, 59, 0], [3, 60, 0]));
  expect(surfaceResult.result, JSON.stringify(surfaceResult.result)).toMatchObject({
    success: true,
    handled: true,
    bindingId: 'sample:surface-cart-binding',
  });
  expect(runtime.server.getInventoryPointerView(runtime.playerId).revision).toBe(surfaceBefore.revision + 1);
  expect(runtime.view().entities.filter((entity) => entity.type === 'transport')).toHaveLength(2);
  const finalTransports = runtime.view().transports;
  expect(finalTransports).toHaveLength(2);
  expect(finalTransports?.find((transport) => transport.definitionId === 'sample:surface-cart')).toMatchObject({
    pose: { position: [3.5, 60, 0.5] },
  });

  const beforePhysics = runtime.view().transports;
  expect(() => runtime.advanceSession(100)).not.toThrow();
  expect(runtime.view().transports).toEqual(beforePhysics);
  expect(runtime.view().entities.filter((entity) => entity.type === 'transport')).toHaveLength(2);
});

it('rejects a different support provider and duplicate occupancy without partial owner changes', async () => {
  const runtime = await create();
  await addRoute(runtime);
  await putVoxel(runtime, [3, 59, 0], 5);
  runtime.server.giveItem(runtime.playerId, { itemId: 'sample:route-cart-kit', count: 2 });
  runtime.takeCommits();
  const first = await runtime.performAction(deploy(runtime, [1, 59, 0], [1, 60, 0]));
  expect(first.result).toMatchObject({ success: true, handled: true });

  const beforeWrongSurface = state(runtime);
  const wrongSurface = await runtime.performAction(deploy(runtime, [3, 59, 0], [3, 60, 0]));
  expect(wrongSurface.result).toMatchObject({ success: false });
  expect(wrongSurface.commits).toEqual([]);
  expect(state(runtime)).toEqual(beforeWrongSurface);

  const beforeOccupied = state(runtime);
  const duplicate = await runtime.performAction(deploy(runtime, [1, 59, 0], [1, 60, 0]));
  expect(duplicate.result).toMatchObject({ success: false });
  expect(duplicate.commits).toEqual([]);
  expect(state(runtime)).toEqual(beforeOccupied);
});

it('rejects stale selection fields atomically and leaves unconfigured voxels unchanged', async () => {
  const runtime = await create();
  await putVoxel(runtime, [3, 59, 0], 5);
  runtime.takeCommits();
  runtime.server.giveItem(runtime.playerId, { itemId: 'sample:route-cart-kit', count: 1 });
  const before = state(runtime);
  for (const field of ['inventoryRevision', 'modeRevision', 'creativeCatalogRevision', 'selectedSlot'] as const) {
    const current = selection(runtime);
    const expectedSelection = { ...current, [field]: current[field] + 1 };
    const rejected = await runtime.performAction(deploy(runtime, [1, 59, 0], [1, 60, 0], expectedSelection));
    expect(rejected.result, `${field}: ${JSON.stringify(rejected.result)}`).toMatchObject({ success: false });
    expect(rejected.commits).toEqual([]);
    expect(state(runtime)).toEqual(before);
  }

  const unsupported = await runtime.performAction(deploy(runtime, [3, 59, 0], [3, 60, 0]));
  expect(unsupported.result).toMatchObject({ success: false });
  expect(unsupported.commits).toEqual([]);
  expect(state(runtime)).toEqual(before);
});

for (const mode of ['veto', 'forge'] as const) {
  it(`rejects registered ${mode} rules without changing transport or inventory owners`, async () => {
    const runtime = await create(mode);
    await addRoute(runtime);
    runtime.server.giveItem(runtime.playerId, { itemId: 'sample:route-cart-kit', count: 1 });
    runtime.takeCommits();
    const before = state(runtime);
    const operationSpy = vi.spyOn(runtime.server, 'invokeActorModuleOperation');

    const rejected = await runtime.performAction(deploy(runtime, [1, 59, 0], [1, 60, 0]));
    const registeredResult = operationSpy.mock.results[0]?.value;

    const expectedFailure =
      mode === 'veto'
        ? { ok: false, code: 'RULE_REJECTED', message: 'transport-test-veto' }
        : { ok: false, code: 'OPERATION_FAILED', message: 'transport-candidate-stale' };
    expect(registeredResult, `registered=${JSON.stringify(registeredResult)}`).toMatchObject(expectedFailure);
    expect(rejected.result).toMatchObject({ success: false });
    expect(rejected.commits).toEqual([]);
    expect(state(runtime)).toEqual(before);
  });
}

it('restores a deployed transport from a portable Authority checkpoint with a current lifetime reference', async () => {
  const persistence = new MemoryGamePersistence({ clone: testCorePlatform.clone });
  const source = await create(undefined, persistence);
  await addRoute(source);
  source.server.giveItem(source.playerId, { itemId: 'sample:route-cart-kit', count: 1 });
  const deployed = await source.performAction(deploy(source, [1, 59, 0], [1, 60, 0]));
  expect(deployed.result).toMatchObject({ success: true, handled: true });

  const portable = source.exportPortableCheckpoint();
  if (!isPortableTransportCheckpoint(portable)) throw new TypeError('Invalid transport checkpoint.');
  const { transports, identities } = portable.gameplay.entityStore;
  const savedTransport = transports?.[0];
  const savedIdentity = identities.find(({ entityId }) => entityId === savedTransport?.entityId)!;
  await source.persistPortableCheckpoint(portable);

  const restored = await create(undefined, persistence);
  const restoredTransport = restored.view().transports![0]!;
  expect(restoredTransport.reference).toEqual(restored.server.createEntityReference(savedTransport!.entityId));
  expect(restoredTransport.reference.lifetime).toBe(savedIdentity!.lifetime);
  expect(restoredTransport).toMatchObject({
    definitionId: savedTransport!.definitionId,
    pose: { yaw: savedTransport!.yaw, position: [1.5, 59, 0.5] },
    routeCursor: savedTransport!.routeCursor,
    fuel: savedTransport!.fuel,
    inventory: savedTransport!.inventory,
  });
});

it('rejects a portable transport checkpoint with an unknown definition without changing saved or source state', async () => {
  const persistence = new MemoryGamePersistence({ clone: testCorePlatform.clone });
  const source = await create(undefined, persistence);
  await addRoute(source);
  source.server.giveItem(source.playerId, { itemId: 'sample:route-cart-kit', count: 1 });
  const deployed = await source.performAction(deploy(source, [1, 59, 0], [1, 60, 0]));
  expect(deployed.result).toMatchObject({ success: true, handled: true });
  const portable = source.exportPortableCheckpoint();
  if (!isPortableTransportCheckpoint(portable)) throw new TypeError('Invalid transport checkpoint.');
  const component = portable.gameplay.entityStore.transports?.[0];
  await source.persistPortableCheckpoint(portable);

  persistence.saveFrozenSnapshot({
    ...portable,
    gameplay: {
      ...portable.gameplay,
      entityStore: {
        ...portable.gameplay.entityStore,
        transports: [{ ...component!, definitionId: 'sample:unknown-transport-definition' }],
      },
    },
  });
  const persistenceBefore = [persistence.loadGameCheckpoint(), persistence.loadGameplaySnapshot()];
  const sourceBefore = state(source);

  await expect(source.server.restore()).rejects.toThrow(/transport|definition|checkpoint/i);
  expect([persistence.loadGameCheckpoint(), persistence.loadGameplaySnapshot()]).toEqual(persistenceBefore);
  expect(state(source)).toEqual(sourceBefore);
});

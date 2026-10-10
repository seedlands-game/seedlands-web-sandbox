import { expect } from 'vitest';
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

export type Runtime = Awaited<ReturnType<typeof create>>;

const modules = (routeElevation: 0 | 1) => [
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
              variant: routeElevation ? 'sample:slope-east' : 'sample:straight',
              edges: [
                {
                  entry: { side: 'west', elevation: 0 },
                  exit: { side: 'east', elevation: routeElevation },
                  curve: 'line',
                  slopeDelta: routeElevation,
                },
                {
                  entry: { side: 'east', elevation: routeElevation },
                  exit: { side: 'west', elevation: 0 },
                  curve: 'line',
                  slopeDelta: routeElevation ? -1 : 0,
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

export type RuleMode = 'veto' | 'forge';
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
const composition = (ruleMode?: RuleMode, extraModules: readonly ModModule[] = [], routeElevation: 0 | 1 = 0) => {
  const registeredModules = [
    ...modules(routeElevation),
    ...(ruleMode ? [registeredRuleModule(ruleMode)] : []),
    ...extraModules,
  ];
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
export const create = async (
  ruleMode?: RuleMode,
  persistence?: MemoryGamePersistence,
  extraModules: readonly ModModule[] = [],
  routeElevation: 0 | 1 = 0,
) => {
  const world = composition(ruleMode, extraModules, routeElevation);
  const moduleActorAuthority = createGameplayActorAuthority(world.resources, { playerAlias: 'transport-player' });
  const runtime = await AuthorityRuntime.create({
    epoch: 'transport-authority-deployment',
    seedText: 'transport-authority-deployment',
    platform: testCorePlatform,
    composition: world,
    moduleActorAuthority,
    moduleSystemAuthority: createGameplaySystemAuthority(world),
    worldgenProvider: worldgenProviderForComposition(world),
    initialWorldTime: 8,
    startTimeMs: 0,
    initialPlayerBodyPosition: [0.5, 60, 0.5],
    ...(persistence ? { persistence } : {}),
  });
  return Object.assign(runtime, { commandBinding: moduleActorAuthority.forActor(runtime.playerId, 'player')! });
};
export const isPortableTransportCheckpoint = (
  checkpoint: ReturnType<AuthorityRuntime['exportPortableCheckpoint']>,
): checkpoint is ReturnType<AuthorityRuntime['exportPortableCheckpoint']> & {
  gameplay: GameplaySnapshotV4 & { entityStore: EntityStoreComponentSnapshotV2 };
} => checkpoint.gameplay.version === 4 && checkpoint.gameplay.entityStore.version === 2;

export const selection = (runtime: Runtime) => {
  const player = runtime.server.getPlayerState(runtime.playerId);
  return {
    inventoryRevision: runtime.server.getInventoryPointerView(runtime.playerId).revision,
    modeRevision: player.mode!.revision,
    creativeCatalogRevision: player.creativeCatalog!.revision,
    selectedSlot: player.selectedSlot,
  };
};

export const deploy = (
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

export const putVoxel = async (runtime: Runtime, position: readonly [number, number, number], value: number) => {
  const committed = await runtime.editWorld('transport-deployment-fixture', [
    { x: position[0], y: position[1], z: position[2], value },
  ]);
  expect(committed).toMatchObject({ committed: true });
};

export const addRoute = async (runtime: Runtime) => {
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

export const state = (runtime: Runtime) => ({
  authoritySnapshot: runtime.snapshot(),
  inventory: runtime.server.getInventoryPointerView(runtime.playerId),
  gameplayRevision: runtime.server.gameplayRevision,
  worldRevision: runtime.server.worldRevision,
  commitSequence: runtime.server.commitSequence,
  entities: runtime.view().entities,
  transports: Reflect.get(runtime.view(), 'transports'),
});

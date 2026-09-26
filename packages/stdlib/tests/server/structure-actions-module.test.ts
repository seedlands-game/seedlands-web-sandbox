import { describe, expect, it } from 'vitest';
import { assembleWorldPacks, definePack } from '../../src/server/composition/assembly';
import type { ModModule } from '../../src/server/composition/contracts';
import { createRegisteredOperationRuntime } from '../../src/server/composition/registered-operations';
import { WorldResourceAuthorizer } from '../../src/server/harness/world-authorization';
import type { ItemDefinitionRegistry } from '../../src/server/gameplay/item-registry';
import { defineContentModule } from '../../src/server/gameplay/modules/content-module';
import { defineStructureDefinitionV1 } from '../../src/server/gameplay/modules/structure-definition';
import { defineStructureDefinitionModule } from '../../src/server/gameplay/modules/structure-definition-module';
import { VOXEL_GEOMETRY_CAPABILITY } from '../../src/server/gameplay/modules/voxel-geometry-module';
import { createVoxelGeometryRegistryV1 } from '../../src/world/voxel-geometry';
import {
  STRUCTURE_PLACE_OPERATION,
  STRUCTURE_RESOURCE,
  defineStructureActionsModuleV1,
} from '../../src/server/gameplay/modules/structure-actions-module';
import { createStructureStatePort } from '../../src/server/gameplay/modules/structure-state-port';

const cells = new Map<string, number>([
  ['1,31,0', 0],
  ['1,32,0', 0],
  ['1,30,0', 3],
]);
const key = (position: readonly number[]) => position.join(',');
const structure = defineStructureDefinitionV1({
  version: 1,
  id: 'fixture:gate',
  rootRole: 'lower',
  initialState: 'north-closed',
  parts: [
    { role: 'lower', offset: [0, 0, 0] },
    { role: 'upper', offset: [0, 1, 0] },
  ],
  states: [
    { id: 'north-closed', variants: { lower: 81, upper: 82 }, collision: { lower: 'blocking', upper: 'blocking' } },
    { id: 'north-open', variants: { lower: 83, upper: 84 }, collision: { lower: 'passable', upper: 'passable' } },
  ],
  transitions: [
    { id: 'toggle', from: 'north-closed', to: 'north-open' },
    { id: 'toggle', from: 'north-open', to: 'north-closed' },
  ],
  legacyStates: [{ stateId: 'north-closed', variants: { lower: 52, upper: 52 } }],
  support: { role: 'lower', offset: [0, -1, 0], requirement: 'solid' },
  variantDescriptorKind: 'voxel-semantics',
  placementItemId: 'fixture:gate-item',
  dropOwnerRole: 'lower',
  drop: { itemId: 'fixture:gate-item', count: 1 },
});

function fixture(allow = true) {
  const content = defineContentModule({
    moduleId: 'fixture:content',
    items: [{ id: 'fixture:gate-item', storageId: 'gate', name: 'Gate', stackLimit: 16 }],
    voxels: [
      {
        id: 'fixture:support',
        storageId: 3,
        solid: true,
        targetable: true,
        renderable: true,
        meshKind: 'cube',
        emission: 0,
        lightCost: 1,
        faceMaterials: [1, 1, 1, 1, 1, 1],
      },
      ...[81, 82, 83, 84].map((storageId) => ({
        id: `fixture:gate-${storageId}`,
        storageId,
        solid: storageId === 81 || storageId === 82,
        targetable: true,
        renderable: true,
        meshKind: 'model' as const,
        emission: 0,
        lightCost: 1,
        faceMaterials: [1, 1, 1, 1, 1, 1] as const,
      })),
      {
        id: 'fixture:legacy-gate',
        storageId: 52,
        solid: true,
        targetable: true,
        renderable: true,
        meshKind: 'model',
        emission: 0,
        lightCost: 1,
        faceMaterials: [1, 1, 1, 1, 1, 1],
      },
    ],
    meleeDefinitions: [],
  });
  const geometryRegistry = createVoxelGeometryRegistryV1(
    [52, 81, 82, 83, 84].map((voxel) => ({
      version: 1 as const,
      voxel,
      boxes: [{ min: [0, 0, 0] as const, max: [1, 1, 0.125] as const, material: 1 }],
      collision: voxel === 83 || voxel === 84 ? [] : [{ min: [0, 0, 0] as const, max: [1, 1, 0.125] as const }],
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
  const definitions = defineStructureDefinitionModule({ moduleId: 'fixture:structures', definitions: [structure] });
  const actions = defineStructureActionsModuleV1({
    moduleId: 'fixture:structure-actions',
    policy: {
      placementState: () => 'north-closed',
      toggleTransitionId: () => 'toggle',
      isReplaceable: (voxel) => voxel === 0,
    },
  });
  const pack = definePack({
    id: 'fixture:world',
    version: '1.0.0',
    kind: 'playbook',
    modules: [content, geometry, definitions, actions],
  });
  const composition = assembleWorldPacks(
    [
      {
        ...pack,
        integrity: { algorithm: 'sha256', manifestDigest: 'a'.repeat(64), entryDigest: 'b'.repeat(64), resources: [] },
      },
    ],
    { approvedPermissions: { 'fixture:world': actions.descriptor.permissions! } },
  );
  let gameplayRevision = 0;
  let preparedCandidate: unknown;
  const state = createStructureStatePort({
    composition,
    items: composition.capability<ItemDefinitionRegistry>('seedlands:items'),
    actor: () => ({
      version: 1 as const,
      reference: { entityId: 'alice', epoch: 1, lifetime: 1 },
      position: [0.5, 31, 0.5],
      lifecycle: 'alive',
      mode: { value: 'survival', revision: 0 },
      inventoryRevision: 0,
      slots: [{ itemId: 'gate', count: 2 }, ...Array.from({ length: 7 }, () => null)],
      selectedSlot: 0,
      creativeCatalog: { revision: 0, selectedSlot: 0, hotbar: Array.from({ length: 8 }, () => null) },
    }),
    readCell: (position) => {
      const voxel = cells.get(key(position));
      return voxel === undefined ? null : { voxel, fluid: 0 };
    },
    gameplayRevision: () => gameplayRevision,
    worldRevision: () => 0,
    prepare: (_observed, execution) => {
      preparedCandidate = execution.candidateValue;
      return {
        ok: true as const,
        revision: gameplayRevision + 1,
        value: { success: true },
        validate: () => undefined,
        apply: () => {
          gameplayRevision += 1;
        },
      };
    },
  });
  const authorizer = new WorldResourceAuthorizer(
    {
      principals: [{ id: 'human', boundEntityId: 'alice' }],
      rules: allow
        ? [
            {
              effect: 'allow',
              principal: { ids: ['human'] },
              resources: [STRUCTURE_RESOURCE],
              operations: ['read', 'execute'],
              scope: 'any',
            },
          ]
        : [],
    },
    composition.resources,
  );
  const execution = createRegisteredOperationRuntime({
    composition,
    authorizer,
    clone: structuredClone,
    state: state.state,
  }).bind({
    moduleId: actions.descriptor.id,
    principalId: 'human',
    originalActorId: 'alice',
  });
  return { execution, state, preparedCandidate: () => preparedCandidate };
}

describe('registered Structure actions module', () => {
  it('derives a place plan only from the actor projection, canonical target and Pack placement policy', () => {
    const world = fixture();
    const result = world.execution.invoke({
      operationId: STRUCTURE_PLACE_OPERATION,
      target: { kind: 'voxel', position: [1, 31, 0] },
      input: { hit: [1, 30, 0], adjacent: [1, 31, 0] },
    });
    if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
    expect(result).toMatchObject({ ok: true, value: { success: true } });
    expect(world.preparedCandidate()).toMatchObject({
      kind: 'place',
      definitionId: 'fixture:gate',
      toState: 'north-closed',
    });
  });

  it('rejects client identity/orientation fields and denied registered resources', () => {
    const world = fixture();
    expect(
      world.execution.invoke({
        operationId: STRUCTURE_PLACE_OPERATION,
        target: { kind: 'voxel', position: [1, 31, 0] },
        input: { hit: [1, 30, 0], adjacent: [1, 31, 0], stateId: 'north-open' },
      }),
    ).toMatchObject({ ok: false, code: 'OPERATION_FAILED' });
    expect(
      fixture(false).execution.invoke({
        operationId: STRUCTURE_PLACE_OPERATION,
        target: { kind: 'voxel', position: [1, 31, 0] },
        input: { hit: [1, 30, 0], adjacent: [1, 31, 0] },
      }),
    ).toMatchObject({ ok: false, code: 'WORLD_PERMISSION_DENIED' });
  });
});

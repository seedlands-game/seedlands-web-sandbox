import { assembleWorldPacks, definePack } from '../../src/server/composition/assembly';
import type { ModModule } from '../../src/server/composition/contracts';
import { defineContentModule } from '../../src/server/gameplay/modules/content-module';
import {
  defineStructureActionsModuleV1,
  type StructureActionPolicyV1,
} from '../../src/server/gameplay/modules/structure-actions-module';
import { defineStructureDefinitionV1 } from '../../src/server/gameplay/modules/structure-definition';
import { defineStructureDefinitionModule } from '../../src/server/gameplay/modules/structure-definition-module';
import { VOXEL_GEOMETRY_CAPABILITY } from '../../src/server/gameplay/modules/voxel-geometry-module';
import { createVoxelGeometryRegistryV1 } from '../../src/world/voxel-geometry';
import { Voxel } from '../../src/world/voxel';

export const structureTestOrientations = ['north', 'east', 'south', 'west'] as const;
export const structureTestVariant = (
  orientation: (typeof structureTestOrientations)[number],
  open: boolean,
  upper: boolean,
) => 101 + structureTestOrientations.indexOf(orientation) * 4 + Number(open) * 2 + Number(upper);

const definition = defineStructureDefinitionV1({
  version: 1,
  id: 'fixture:gate',
  rootRole: 'lower',
  initialState: 'north-closed',
  parts: [
    { role: 'lower', offset: [0, 0, 0] },
    { role: 'upper', offset: [0, 1, 0] },
  ],
  states: structureTestOrientations.flatMap((orientation) => [
    {
      id: `${orientation}-closed`,
      variants: {
        lower: structureTestVariant(orientation, false, false),
        upper: structureTestVariant(orientation, false, true),
      },
      collision: { lower: 'blocking' as const, upper: 'blocking' as const },
    },
    {
      id: `${orientation}-open`,
      variants: {
        lower: structureTestVariant(orientation, true, false),
        upper: structureTestVariant(orientation, true, true),
      },
      collision: { lower: 'passable' as const, upper: 'passable' as const },
    },
  ]),
  transitions: structureTestOrientations.flatMap((orientation) => [
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

export function createStructureTestComposition() {
  const values = [
    52,
    ...structureTestOrientations.flatMap((orientation) => [
      structureTestVariant(orientation, false, false),
      structureTestVariant(orientation, false, true),
      structureTestVariant(orientation, true, false),
      structureTestVariant(orientation, true, true),
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
      {
        id: 'fixture:non-targetable',
        storageId: Voxel.Glass,
        solid: false,
        targetable: false,
        renderable: true,
        meshKind: 'glass',
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
  return Object.freeze({ assembled, actions });
}

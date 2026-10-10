import {
  defineContentModule,
  defineInventoryModule,
  defineInventoryActionsModule,
  defineBlockActionsModule,
  defineBlockRulesModule,
  defineModeModule,
  defineRulesetModule,
  defineStandardWorldgenModule,
  type ModModule,
  type StandardWorldgenProvider,
} from '@seedlands/stdlib/mod-api';
import { CHUNK_SIZE, voxelIndex } from '@seedlands/stdlib/world/voxel';

const buildingWorldgenIdentity = Object.freeze({
  id: 'sample:building-worldgen',
  implementationVersion: '1.0.0',
  configurationIdentity: 'sample:building-flat-v1',
  supportedGeneratorVersions: Object.freeze([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]),
  artifactIdentity: 'sample:building@1',
});

const buildingWorldgenProvider: StandardWorldgenProvider = Object.freeze({
  identity: buildingWorldgenIdentity,
  generate({ generatorVersion, coordinate, epoch, revision }) {
    const voxels = new Uint16Array(CHUNK_SIZE ** 3);
    for (let y = 0; y < CHUNK_SIZE; y += 1)
      if (coordinate.y * CHUNK_SIZE + y <= 59)
        for (let z = 0; z < CHUNK_SIZE; z += 1) for (let x = 0; x < CHUNK_SIZE; x += 1) voxels[voxelIndex(x, y, z)] = 3;
    return { coordinate, provider: buildingWorldgenIdentity, generatorVersion, epoch, revision, voxels };
  },
  sampleVoxel: ({ y }) => (y <= 59 ? 3 : 0),
});

/** Two explicitly declared materials; no import of the default Playbook or its definitions. */
export function buildingModules(withConversion: boolean): ModModule[] {
  return [
    defineStandardWorldgenModule({ moduleId: 'sample:worldgen', provider: buildingWorldgenProvider }),
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
        ...[3, 4].map((storageId) => ({
          id: storageId === 3 ? 'sample:stone-voxel' : 'sample:wood-voxel',
          storageId,
          solid: true,
          targetable: true,
          renderable: true,
          meshKind: 'cube' as const,
          emission: 0,
          lightCost: 16,
          faceMaterials: [4, 4, 4, 4, 4, 4] as const,
        })),
      ],
      items: [
        {
          id: 'sample:wood',
          storageId: 'sample:wood',
          name: '原木',
          itemType: 'block',
          stackLimit: 64,
          capabilities: [{ type: 'place', voxel: 4 }],
        },
        {
          id: 'sample:stone',
          storageId: 'sample:stone',
          name: '石块',
          itemType: 'block',
          stackLimit: 64,
          capabilities: [{ type: 'place', voxel: 3 }],
        },
      ],
      recipes: withConversion
        ? [
            {
              id: 'sample:convert',
              storageId: 'click-convert',
              inputs: [{ itemId: 'sample:wood', count: 1 }],
              outputs: [{ itemId: 'sample:stone', count: 2 }],
            },
          ]
        : [],
      meleeDefinitions: [],
      ...(withConversion ? { craftingProvider: true } : {}),
    }),
    defineInventoryModule(),
    defineInventoryActionsModule(),
    defineRulesetModule({ id: 'sample:building-rules', version: '1.0.0' }),
    defineModeModule(),
    defineBlockActionsModule(),
    defineBlockRulesModule({
      moduleId: 'sample:building-blocks',
      voxelDefinitions: [
        { voxel: 0, hardnessSeconds: null, preferredTool: null, drop: null, replaceable: true },
        {
          voxel: 3,
          hardnessSeconds: 0.2,
          preferredTool: null,
          drop: { itemId: 'sample:stone', count: 1 },
          replaceable: false,
        },
        {
          voxel: 4,
          hardnessSeconds: 0.2,
          preferredTool: null,
          drop: { itemId: 'sample:wood', count: 1 },
          replaceable: false,
        },
      ],
    }),
  ];
}

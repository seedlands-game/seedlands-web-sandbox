import {
  defineBlockActionsModule,
  defineBlockRulesModule,
  defineContentModule,
  definePack,
  defineStandardWorldgenModule,
  type StandardWorldgenProvider,
} from '@seedlands/stdlib/mod-api';
import { CHUNK_SIZE, voxelIndex } from '@seedlands/stdlib/world/voxel';

export const MODULAR_WORLD_SENTINEL_VOXEL = 500;
export const MODULAR_WORLD_SENTINEL_POSITION = [10_000, 100, 10_000] as const;
export const MODULAR_WORLD_PRESENTATION = 'apps/web/tests/fixtures/packs/modular-world/presentation.json';
export const MODULAR_WORLD_TEXTURE = 'apps/web/tests/fixtures/packs/modular-world/sentinel-glass.svg';

const contains = (coordinate: number, target: number): boolean =>
  target >= coordinate * 32 && target < (coordinate + 1) * 32;

export const modularWorldgenIdentity = Object.freeze({
  id: 'sample:modular-worldgen',
  implementationVersion: '1.0.0',
  configurationIdentity: 'sample:modular-world-v1',
  supportedGeneratorVersions: Object.freeze([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]),
  artifactIdentity: 'sample:modular-world@1.0.0',
});

export const modularWorldgenProvider: StandardWorldgenProvider = Object.freeze({
  identity: modularWorldgenIdentity,
  generate({ generatorVersion, coordinate, epoch, revision }) {
    const voxels = new Uint16Array(CHUNK_SIZE ** 3);
    if (contains(coordinate.y, 64)) {
      const localY = 64 - coordinate.y * CHUNK_SIZE;
      for (let z = 0; z < CHUNK_SIZE; z += 1)
        for (let x = 0; x < CHUNK_SIZE; x += 1) voxels[voxelIndex(x, localY, z)] = MODULAR_WORLD_SENTINEL_VOXEL;
    }
    if (
      contains(coordinate.x, MODULAR_WORLD_SENTINEL_POSITION[0]) &&
      contains(coordinate.y, MODULAR_WORLD_SENTINEL_POSITION[1]) &&
      contains(coordinate.z, MODULAR_WORLD_SENTINEL_POSITION[2])
    ) {
      const x = MODULAR_WORLD_SENTINEL_POSITION[0] - coordinate.x * 32;
      const y = MODULAR_WORLD_SENTINEL_POSITION[1] - coordinate.y * 32;
      const z = MODULAR_WORLD_SENTINEL_POSITION[2] - coordinate.z * 32;
      voxels[voxelIndex(x, y, z)] = MODULAR_WORLD_SENTINEL_VOXEL;
    }
    return {
      coordinate,
      provider: modularWorldgenIdentity,
      generatorVersion,
      epoch,
      revision,
      voxels,
    };
  },
  sampleVoxel({ x, y, z }) {
    if (
      x === MODULAR_WORLD_SENTINEL_POSITION[0] &&
      y === MODULAR_WORLD_SENTINEL_POSITION[1] &&
      z === MODULAR_WORLD_SENTINEL_POSITION[2]
    )
      return MODULAR_WORLD_SENTINEL_VOXEL;
    return y === 64 ? MODULAR_WORLD_SENTINEL_VOXEL : 0;
  },
});

/**
 * These Pack-owned candidates deliberately remain unregistered until the
 * concurrent public voxel semantics, presentation, and actor-archetype APIs
 * accept them. No Classic definition is imported as a fallback.
 */
export const modularWorldContentCandidates = Object.freeze({
  air: Object.freeze({
    id: 'sample:air',
    storageId: 0,
    solid: false,
    targetable: false,
    renderable: false,
    meshKind: 'cube' as const,
    emission: 0,
    lightCost: 1,
    faceMaterials: Object.freeze([21, 21, 21, 21, 21, 21]),
    materialCategories: Object.freeze([[21, 'cutout'] as const]),
  }),
  item: Object.freeze({
    id: 'sample:sentinel-glass',
    storageId: 'sample:sentinel-glass',
    name: '哨兵玻璃',
    itemType: 'block' as const,
    stackLimit: 64,
    capabilities: Object.freeze([{ type: 'place' as const, voxel: MODULAR_WORLD_SENTINEL_VOXEL }]),
  }),
  voxel: Object.freeze({
    id: 'sample:sentinel-glass',
    storageId: MODULAR_WORLD_SENTINEL_VOXEL,
    solid: true,
    targetable: true,
    renderable: true,
    meshKind: 'glass' as const,
    emission: 15,
    lightCost: 1,
    faceMaterials: Object.freeze([21, 21, 21, 21, 21, 21]),
  }),
  blockRule: Object.freeze({
    voxel: MODULAR_WORLD_SENTINEL_VOXEL,
    hardnessSeconds: 0.2,
    preferredTool: null,
    drop: Object.freeze({ itemId: 'sample:sentinel-glass', count: 1 }),
    replaceable: false,
  }),
  actorProfile: Object.freeze({
    archetype: 'sample:sentinel',
    entityType: 'creature',
    maxHealth: 20,
    navigation: Object.freeze({ speed: 3, perceptionRange: 12 }),
    initialBehavior: 'idle',
    disposition: 'neutral',
  }),
  presentationResource: 'modular-world.presentation.json',
});

export const pack = definePack({
  id: 'sample:modular-world',
  version: '1.0.0',
  kind: 'playbook',
  entry: 'modular-world.mjs',
  resources: [MODULAR_WORLD_PRESENTATION, MODULAR_WORLD_TEXTURE],
  presentation: { path: MODULAR_WORLD_PRESENTATION },
  modules: [
    defineStandardWorldgenModule({
      moduleId: 'sample:modular-worldgen-module',
      provider: modularWorldgenProvider,
    }),
    defineContentModule({
      moduleId: 'sample:modular-world-content',
      items: [modularWorldContentCandidates.item],
      voxels: [modularWorldContentCandidates.air, modularWorldContentCandidates.voxel],
      meleeDefinitions: [],
      actorProfiles: [modularWorldContentCandidates.actorProfile],
    }),
    defineBlockActionsModule(),
    defineBlockRulesModule({
      moduleId: 'sample:modular-world-block-rules',
      voxelDefinitions: [modularWorldContentCandidates.blockRule],
    }),
  ],
});

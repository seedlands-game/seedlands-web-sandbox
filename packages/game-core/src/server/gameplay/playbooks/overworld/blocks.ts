import type { VoxelGameplayDefinition } from '@seedlands/game-core/mod-api';

/** Version 1 content preserves the supported numeric voxel palette. */
const definitions: Readonly<Record<number, VoxelGameplayDefinition>> = Object.freeze({
  [9]: {
    voxel: 9,
    hardnessSeconds: 0.45,
    preferredTool: null,
    drop: { itemId: 'glowstone-block', count: 1 },
    replaceable: false,
  },
  [10]: {
    voxel: 10,
    hardnessSeconds: 0.45,
    preferredTool: null,
    drop: { itemId: 'lantern', count: 1 },
    replaceable: false,
  },
  [0]: { voxel: 0, hardnessSeconds: null, preferredTool: null, drop: null, replaceable: true },
  [1]: {
    voxel: 1,
    hardnessSeconds: 0.35,
    preferredTool: null,
    drop: { itemId: 'dirt-block', count: 1 },
    replaceable: false,
  },
  [2]: {
    voxel: 2,
    hardnessSeconds: 0.35,
    preferredTool: null,
    drop: { itemId: 'dirt-block', count: 1 },
    replaceable: false,
  },
  [3]: {
    voxel: 3,
    hardnessSeconds: 2.4,
    preferredTool: 'pickaxe',
    drop: { itemId: 'stone-block', count: 1 },
    replaceable: false,
  },
  [4]: {
    voxel: 4,
    hardnessSeconds: 1.2,
    preferredTool: 'axe',
    drop: { itemId: 'wood-block', count: 1 },
    replaceable: false,
  },
  [5]: {
    voxel: 5,
    hardnessSeconds: 0.2,
    preferredTool: 'axe',
    drop: { itemId: 'berry', count: 1 },
    replaceable: false,
  },
  [6]: {
    voxel: 6,
    hardnessSeconds: 0.3,
    preferredTool: null,
    drop: { itemId: 'sand-block', count: 1 },
    replaceable: false,
  },
  [7]: { voxel: 7, hardnessSeconds: null, preferredTool: null, drop: null, replaceable: false },
  [8]: { voxel: 8, hardnessSeconds: null, preferredTool: null, drop: null, replaceable: true },
});

export const overworldBlocks: readonly VoxelGameplayDefinition[] = Object.freeze(
  Object.values(definitions).map((definition) =>
    Object.freeze({ ...definition, drop: definition.drop ? Object.freeze({ ...definition.drop }) : null }),
  ),
);

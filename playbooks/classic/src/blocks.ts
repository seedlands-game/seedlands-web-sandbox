import type { VoxelGameplayDefinition } from '@seedlands/stdlib/mod-api';

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
    minimumTier: 1,
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
  [11]: {
    voxel: 11,
    hardnessSeconds: 1.2,
    preferredTool: 'axe',
    drop: { itemId: 'workbench', count: 1 },
    replaceable: false,
  },
  [12]: {
    voxel: 12,
    hardnessSeconds: 1.2,
    preferredTool: 'axe',
    drop: { itemId: 'chest', count: 1 },
    replaceable: false,
  },
  [13]: {
    voxel: 13,
    hardnessSeconds: 2.4,
    preferredTool: 'pickaxe',
    drop: { itemId: 'furnace', count: 1 },
    replaceable: false,
  },
  [14]: {
    voxel: 14,
    hardnessSeconds: 2.8,
    preferredTool: 'pickaxe',
    minimumTier: 1,
    drop: { itemId: 'coal', count: 1 },
    replaceable: false,
  },
  [15]: {
    voxel: 15,
    hardnessSeconds: 3.2,
    preferredTool: 'pickaxe',
    minimumTier: 2,
    drop: { itemId: 'raw-iron', count: 1 },
    replaceable: false,
  },
});

export const overworldBlocks: readonly VoxelGameplayDefinition[] = Object.freeze(
  Object.values(definitions).map((definition) =>
    Object.freeze({ ...definition, drop: definition.drop ? Object.freeze({ ...definition.drop }) : null }),
  ),
);

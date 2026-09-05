import { Voxel } from '../../world/voxel';
import { ItemIds, type ItemStack } from './item-registry';

export type VoxelGameplayDefinition = Readonly<{
  voxel: number;
  hardnessSeconds: number | null;
  preferredTool: 'axe' | 'pickaxe' | null;
  drop: Readonly<ItemStack> | null;
  replaceable: boolean;
}>;

const definitions: Readonly<Record<number, VoxelGameplayDefinition>> = Object.freeze({
  [Voxel.Glowstone]: {
    voxel: Voxel.Glowstone,
    hardnessSeconds: 0.45,
    preferredTool: null,
    drop: { itemId: ItemIds.GlowstoneBlock, count: 1 },
    replaceable: false,
  },
  [Voxel.Lantern]: {
    voxel: Voxel.Lantern,
    hardnessSeconds: 0.45,
    preferredTool: null,
    drop: { itemId: ItemIds.Lantern, count: 1 },
    replaceable: false,
  },
  [Voxel.Air]: { voxel: Voxel.Air, hardnessSeconds: null, preferredTool: null, drop: null, replaceable: true },
  [Voxel.Grass]: {
    voxel: Voxel.Grass,
    hardnessSeconds: 0.35,
    preferredTool: null,
    drop: { itemId: ItemIds.DirtBlock, count: 1 },
    replaceable: false,
  },
  [Voxel.Dirt]: {
    voxel: Voxel.Dirt,
    hardnessSeconds: 0.35,
    preferredTool: null,
    drop: { itemId: ItemIds.DirtBlock, count: 1 },
    replaceable: false,
  },
  [Voxel.Stone]: {
    voxel: Voxel.Stone,
    hardnessSeconds: 2.4,
    preferredTool: 'pickaxe',
    drop: { itemId: ItemIds.StoneBlock, count: 1 },
    replaceable: false,
  },
  [Voxel.Wood]: {
    voxel: Voxel.Wood,
    hardnessSeconds: 1.2,
    preferredTool: 'axe',
    drop: { itemId: ItemIds.WoodBlock, count: 1 },
    replaceable: false,
  },
  [Voxel.Leaves]: {
    voxel: Voxel.Leaves,
    hardnessSeconds: 0.2,
    preferredTool: 'axe',
    drop: { itemId: ItemIds.Berry, count: 1 },
    replaceable: false,
  },
  [Voxel.Sand]: {
    voxel: Voxel.Sand,
    hardnessSeconds: 0.3,
    preferredTool: null,
    drop: { itemId: ItemIds.SandBlock, count: 1 },
    replaceable: false,
  },
  [Voxel.Snow]: { voxel: Voxel.Snow, hardnessSeconds: null, preferredTool: null, drop: null, replaceable: false },
  [Voxel.Water]: { voxel: Voxel.Water, hardnessSeconds: null, preferredTool: null, drop: null, replaceable: true },
});

export function getVoxelGameplayDefinition(voxel: number): VoxelGameplayDefinition {
  const definition = definitions[voxel];
  if (!definition) throw new RangeError(`Unknown voxel gameplay definition: ${voxel}`);
  return definition;
}

export const listVoxelGameplayDefinitions = (): readonly VoxelGameplayDefinition[] => Object.values(definitions);

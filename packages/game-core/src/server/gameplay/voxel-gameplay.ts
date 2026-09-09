import type { ItemStack } from './item-registry';
import { overworldBlocks } from './playbooks/overworld/blocks';

export type VoxelGameplayDefinition = Readonly<{
  voxel: number;
  hardnessSeconds: number | null;
  preferredTool: 'axe' | 'pickaxe' | null;
  drop: Readonly<ItemStack> | null;
  replaceable: boolean;
}>;

/** Compatibility queries for uncomposed engineering hosts share the Pack's single content source. */
export function getVoxelGameplayDefinition(voxel: number): VoxelGameplayDefinition {
  const definition = overworldBlocks.find((definition) => definition.voxel === voxel);
  if (!definition) throw new RangeError(`Unknown voxel gameplay definition: ${voxel}`);
  return definition;
}
export const listVoxelGameplayDefinitions = (): readonly VoxelGameplayDefinition[] => overworldBlocks;

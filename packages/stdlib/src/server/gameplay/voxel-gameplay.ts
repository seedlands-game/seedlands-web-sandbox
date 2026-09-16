import type { ItemStack } from './item-registry';

export type VoxelGameplayDefinition = Readonly<{
  voxel: number;
  hardnessSeconds: number | null;
  minimumTier?: number;
  preferredTool: 'axe' | 'pickaxe' | null;
  drop: Readonly<ItemStack> | null;
  replaceable: boolean;
}>;

export type VoxelGameplayRegistry = Readonly<{
  get(voxel: number): VoxelGameplayDefinition | undefined;
  require(voxel: number): VoxelGameplayDefinition;
  list(): readonly VoxelGameplayDefinition[];
}>;

export function createVoxelGameplayRegistry(
  definitions: readonly VoxelGameplayDefinition[] = [],
): VoxelGameplayRegistry {
  const entries = new Map<number, VoxelGameplayDefinition>();
  for (const definition of definitions) {
    if (!Number.isSafeInteger(definition.voxel) || definition.voxel < 0 || definition.voxel > 65_535)
      throw new TypeError(`Voxel gameplay identity is invalid: ${String(definition.voxel)}`);
    if (entries.has(definition.voxel)) throw new TypeError(`Duplicate voxel gameplay definition: ${definition.voxel}`);
    entries.set(definition.voxel, Object.freeze({ ...definition }));
  }
  const values = Object.freeze([...entries.values()]);
  return Object.freeze({
    get: (voxel) => entries.get(voxel),
    require: (voxel) => {
      const definition = entries.get(voxel);
      if (!definition) throw new RangeError(`No voxel gameplay definition is registered: ${voxel}`);
      return definition;
    },
    list: () => values,
  });
}

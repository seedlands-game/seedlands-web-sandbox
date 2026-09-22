import { isSolid, type FaceMaterialId } from './voxel';
import type { RenderCategory } from './mesh-render-category';

/** V1 render lookup capacity; storage remains Uint16 but registration must be meshable. */
export const MAX_VOXEL_STORAGE_ID = 4_095;
export const MAX_VOXEL_FACE_MATERIAL_ID = 92;
export type VoxelMeshKind = 'cube' | 'model' | 'water' | 'glass' | 'ice';

export type VoxelSemanticsDefinition = Readonly<{
  /** Stable Pack-facing name; never stored in the compact world voxel buffer. */
  id: string;
  /** Compact Uint16 world/storage identity. */
  storageId: number;
  solid: boolean;
  targetable: boolean;
  renderable: boolean;
  /** Rendering topology shared with the numeric mesh data plane. */
  meshKind: VoxelMeshKind;
  emission: number;
  lightCost: number;
  /** Negative/positive faces for X, Y, Z respectively. */
  faceMaterials: readonly [
    FaceMaterialId,
    FaceMaterialId,
    FaceMaterialId,
    FaceMaterialId,
    FaceMaterialId,
    FaceMaterialId,
  ];
  materialCategories?: readonly (readonly [FaceMaterialId, RenderCategory])[];
}>;

export type VoxelSemanticsRegistry = Readonly<{
  get(storageId: number): VoxelSemanticsDefinition | undefined;
  require(storageId: number): VoxelSemanticsDefinition;
  getById(id: string): VoxelSemanticsDefinition | undefined;
  list(): readonly VoxelSemanticsDefinition[];
}>;

const NAMESPACE_ID = /^[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._/-]*$/;

const freezeDefinition = (definition: VoxelSemanticsDefinition): VoxelSemanticsDefinition => {
  if (!NAMESPACE_ID.test(definition.id)) throw new TypeError(`Voxel id must be namespace-qualified: ${definition.id}`);
  if (
    !Number.isSafeInteger(definition.storageId) ||
    definition.storageId < 0 ||
    definition.storageId > MAX_VOXEL_STORAGE_ID
  )
    throw new RangeError(`Voxel storage ID is outside the supported 0..4095 range: ${String(definition.storageId)}`);
  if (
    typeof definition.solid !== 'boolean' ||
    typeof definition.targetable !== 'boolean' ||
    typeof definition.renderable !== 'boolean'
  )
    throw new TypeError(`Voxel flags are invalid: ${definition.id}`);
  if (!['cube', 'model', 'water', 'glass', 'ice'].includes(definition.meshKind))
    throw new TypeError(`Voxel mesh kind is invalid: ${definition.id}`);
  if (!Number.isInteger(definition.emission) || definition.emission < 0 || definition.emission > 15)
    throw new RangeError(`Voxel emission is outside 0..15: ${definition.id}`);
  if (!Number.isInteger(definition.lightCost) || definition.lightCost < 1 || definition.lightCost > 16)
    throw new RangeError(`Voxel light cost is outside 1..16: ${definition.id}`);
  if (
    definition.faceMaterials.length !== 6 ||
    definition.faceMaterials.some(
      (material) => !Number.isSafeInteger(material) || material < 1 || material > MAX_VOXEL_FACE_MATERIAL_ID,
    )
  )
    throw new TypeError(`Voxel face material mapping is invalid: ${definition.id}`);
  const materialCategories = definition.materialCategories ?? [];
  if (
    new Set(materialCategories.map(([material]) => material)).size !== materialCategories.length ||
    materialCategories.some(
      ([material, category]) =>
        !definition.faceMaterials.includes(material) ||
        !['opaque', 'cutout', 'emissive', 'transparent'].includes(category),
    )
  )
    throw new TypeError(`Voxel material category mapping is invalid: ${definition.id}`);
  if (definition.meshKind === 'model' && definition.storageId > 88)
    throw new TypeError(`Pack voxel model geometry is not registered: ${definition.id}`);
  return Object.freeze({
    ...definition,
    faceMaterials: Object.freeze([...definition.faceMaterials]) as VoxelSemanticsDefinition['faceMaterials'],
    ...(materialCategories.length
      ? {
          materialCategories: Object.freeze(
            materialCategories.map(([material, category]) => Object.freeze([material, category] as const)),
          ),
        }
      : {}),
  });
};

/** Creates a frozen, compact-storage-indexed semantics resolver for one composition. */
export function createVoxelSemanticsRegistry(
  definitions: readonly VoxelSemanticsDefinition[] = [],
): VoxelSemanticsRegistry {
  const byStorageId = new Map<number, VoxelSemanticsDefinition>();
  const byId = new Map<string, VoxelSemanticsDefinition>();
  for (const raw of definitions) {
    const definition = freezeDefinition(raw);
    if (byStorageId.has(definition.storageId))
      throw new TypeError(`Duplicate voxel storage ID: ${definition.storageId}`);
    if (byId.has(definition.id)) throw new TypeError(`Duplicate voxel definition: ${definition.id}`);
    byStorageId.set(definition.storageId, definition);
    byId.set(definition.id, definition);
  }
  const values = Object.freeze([...byStorageId.values()].sort((left, right) => left.storageId - right.storageId));
  return Object.freeze({
    get: (storageId) => byStorageId.get(storageId),
    require: (storageId) => {
      const definition = byStorageId.get(storageId);
      if (!definition) throw new RangeError(`No voxel semantics are registered for storage ID: ${storageId}`);
      return definition;
    },
    getById: (id) => byId.get(id),
    list: () => values,
  });
}

export type VoxelSemanticsResolver = Pick<VoxelSemanticsRegistry, 'get'>;

export const voxelIsSolid = (storageId: number, semantics?: VoxelSemanticsResolver): boolean =>
  semantics ? (semantics.get(storageId)?.solid ?? false) : isSolid(storageId);

export const voxelIsPassable = (storageId: number, semantics?: VoxelSemanticsResolver): boolean => {
  const definition = semantics?.get(storageId);
  return definition ? !definition.solid && definition.meshKind !== 'water' : !isSolid(storageId);
};

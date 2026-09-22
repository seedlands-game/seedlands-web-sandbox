import { FaceMaterial, Voxel, faceMaterialFor, isRenderable, isSolid, type FaceMaterialId } from './voxel';
import { hasVoxelModelGeometry, voxelOccludesFullFace } from './voxel-model';
import { MAX_VOXEL_FACE_MATERIAL_ID, type VoxelSemanticsDefinition } from './voxel-semantics';
import { renderCategoryForMaterial } from './mesh-render-category';

export const MESH_SEMANTICS_RECORD_BYTES = 8;
export const MESH_SEMANTICS_MAX_RECORDS = 4_096;
export const MESH_SEMANTICS_MAX_BYTES = MESH_SEMANTICS_RECORD_BYTES * MESH_SEMANTICS_MAX_RECORDS;

export const MESH_SEMANTICS_DEFINED = 1;
export const MESH_SEMANTICS_RENDERABLE = 2;
export const MESH_SEMANTICS_OCCLUDES = 4;
export const MESH_SEMANTICS_MODEL = 8;
export const MESH_SEMANTICS_WATER = 16;
export const MESH_SEMANTICS_GLASS = 32;
export const MESH_SEMANTICS_ICE = 64;

export type MeshSemanticsRecord = Readonly<{
  flags: number;
  faceMaterials: readonly [
    FaceMaterialId,
    FaceMaterialId,
    FaceMaterialId,
    FaceMaterialId,
    FaceMaterialId,
    FaceMaterialId,
  ];
}>;

export type MeshSemanticsLookup = Readonly<{
  bytes: Uint8Array;
  get(storageId: number): MeshSemanticsRecord | undefined;
  isDefined(storageId: number): boolean;
  isRenderable(storageId: number): boolean;
  occludes(storageId: number): boolean;
  isModel(storageId: number): boolean;
  isWater(storageId: number): boolean;
  isGlass(storageId: number): boolean;
  isIce(storageId: number): boolean;
  material(storageId: number, axis: number, positive: boolean): FaceMaterialId | undefined;
  validate(values: ArrayLike<number>): void;
  renderCategory(material: FaceMaterialId): import('./mesh-render-category').RenderCategory;
}>;

export type MeshSemanticsOptions = Readonly<{
  modelStorageIds?: readonly number[];
  waterStorageIds?: readonly number[];
  glassStorageIds?: readonly number[];
  iceStorageIds?: readonly number[];
}>;

function checkedStorageId(storageId: number): void {
  if (!Number.isSafeInteger(storageId) || storageId < 0 || storageId >= MESH_SEMANTICS_MAX_RECORDS)
    throw new RangeError(`Mesh semantics storage ID exceeds the bounded lookup: ${String(storageId)}`);
}

function checkedMaterial(material: number, id: string): FaceMaterialId {
  if (!Number.isSafeInteger(material) || material < 1 || material > MAX_VOXEL_FACE_MATERIAL_ID)
    throw new RangeError(`Mesh semantics material is invalid: ${id}`);
  return material as FaceMaterialId;
}

export function createMeshSemanticsLookup(
  definitions: readonly VoxelSemanticsDefinition[],
  options: MeshSemanticsOptions = {},
): MeshSemanticsLookup {
  const modelIds = new Set(options.modelStorageIds ?? []);
  const waterIds = new Set(options.waterStorageIds ?? []);
  const glassIds = new Set(options.glassStorageIds ?? []);
  const iceIds = new Set(options.iceStorageIds ?? []);
  const categories = new Map(definitions.flatMap((definition) => definition.materialCategories ?? []));
  const maxStorageId = definitions.reduce((max, definition) => Math.max(max, definition.storageId), 0);
  checkedStorageId(maxStorageId);
  const bytes = new Uint8Array((maxStorageId + 1) * MESH_SEMANTICS_RECORD_BYTES);
  for (const definition of definitions) {
    checkedStorageId(definition.storageId);
    const offset = definition.storageId * MESH_SEMANTICS_RECORD_BYTES;
    const model = definition.meshKind === 'model' || modelIds.has(definition.storageId);
    const water = definition.meshKind === 'water' || waterIds.has(definition.storageId);
    const glass = definition.meshKind === 'glass' || glassIds.has(definition.storageId);
    const ice = definition.meshKind === 'ice' || iceIds.has(definition.storageId);
    let flags = MESH_SEMANTICS_DEFINED;
    if (definition.renderable) flags |= MESH_SEMANTICS_RENDERABLE;
    if (definition.solid && !glass && !ice && !model) flags |= MESH_SEMANTICS_OCCLUDES;
    if (model) flags |= MESH_SEMANTICS_MODEL;
    if (water) flags |= MESH_SEMANTICS_WATER;
    if (glass) flags |= MESH_SEMANTICS_GLASS;
    if (ice) flags |= MESH_SEMANTICS_ICE;
    bytes[offset] = flags;
    for (let face = 0; face < 6; face += 1) {
      const material = definition.faceMaterials[face];
      if (material === undefined) throw new TypeError(`Mesh semantics face material is missing: ${definition.id}`);
      bytes[offset + 1 + face] = checkedMaterial(material, definition.id);
    }
  }
  const get = (storageId: number): MeshSemanticsRecord | undefined => {
    if (!Number.isSafeInteger(storageId) || storageId < 0) return undefined;
    const offset = storageId * MESH_SEMANTICS_RECORD_BYTES;
    if (offset + MESH_SEMANTICS_RECORD_BYTES > bytes.length || !(bytes[offset] & MESH_SEMANTICS_DEFINED))
      return undefined;
    return {
      flags: bytes[offset],
      faceMaterials: Array.from(bytes.slice(offset + 1, offset + 7)) as unknown as MeshSemanticsRecord['faceMaterials'],
    };
  };
  const flag = (storageId: number, mask: number) => Boolean((get(storageId)?.flags ?? 0) & mask);
  return Object.freeze({
    bytes,
    get,
    isDefined: (storageId) => flag(storageId, MESH_SEMANTICS_DEFINED),
    isRenderable: (storageId) => flag(storageId, MESH_SEMANTICS_RENDERABLE),
    occludes: (storageId) => flag(storageId, MESH_SEMANTICS_OCCLUDES),
    isModel: (storageId) => flag(storageId, MESH_SEMANTICS_MODEL),
    isWater: (storageId) => flag(storageId, MESH_SEMANTICS_WATER),
    isGlass: (storageId) => flag(storageId, MESH_SEMANTICS_GLASS),
    isIce: (storageId) => flag(storageId, MESH_SEMANTICS_ICE),
    material: (storageId, axis, positive) => {
      if (!Number.isInteger(axis) || axis < 0 || axis > 2) return undefined;
      const record = get(storageId);
      return record?.faceMaterials[axis * 2 + Number(positive)];
    },
    validate: (values) => {
      for (let index = 0; index < values.length; index += 1)
        if (!get(values[index])) throw new RangeError(`No mesh semantics for storage ID: ${values[index]}`);
    },
    renderCategory: (material) => categories.get(material) ?? renderCategoryForMaterial(material),
  });
}

export function createClassicMeshSemanticsLookup(): MeshSemanticsLookup {
  const definitions = Array.from({ length: 89 }, (_, storageId) => ({
    id: `seedlands:classic/${storageId}`,
    storageId,
    solid: isSolid(storageId),
    targetable: storageId !== Voxel.Air,
    renderable: isRenderable(storageId),
    meshKind: hasVoxelModelGeometry(storageId)
      ? 'model'
      : storageId === Voxel.Water
        ? 'water'
        : storageId === Voxel.Glass
          ? 'glass'
          : storageId === Voxel.Ice
            ? 'ice'
            : 'cube',
    emission: 0,
    lightCost: 1,
    faceMaterials: Array.from({ length: 6 }, (_, face) => {
      const material = faceMaterialFor(storageId, Math.floor(face / 2), face % 2 === 1);
      return material ?? FaceMaterial.Stone;
    }) as unknown as MeshSemanticsRecord['faceMaterials'],
  })) as unknown as VoxelSemanticsDefinition[];
  return createMeshSemanticsLookup(definitions, {
    modelStorageIds: Array.from({ length: 89 }, (_, storageId) => storageId).filter(hasVoxelModelGeometry),
    waterStorageIds: [Voxel.Water],
    glassStorageIds: [Voxel.Glass],
    iceStorageIds: [Voxel.Ice],
  });
}

export const classicMeshSemantics = createClassicMeshSemanticsLookup();

export const meshSemanticsFor = (lookup: MeshSemanticsLookup | undefined): MeshSemanticsLookup =>
  lookup ?? classicMeshSemantics;

export const classicMeshSemanticsUsesLegacyOcclusion = (storageId: number): boolean => voxelOccludesFullFace(storageId);

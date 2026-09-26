import type { FaceMaterialId } from './voxel';
import { MAX_VOXEL_FACE_MATERIAL_ID, MAX_VOXEL_STORAGE_ID } from './voxel-semantics';

const MAX_GEOMETRY_DEFINITIONS = MAX_VOXEL_STORAGE_ID + 1;
const MAX_BOXES_PER_VOXEL = 64;

export type VoxelGeometryVectorV1 = readonly [number, number, number];
export type VoxelGeometryBoxV1 = Readonly<{
  min: VoxelGeometryVectorV1;
  max: VoxelGeometryVectorV1;
}>;
export type VoxelRenderBoxV1 = VoxelGeometryBoxV1 & Readonly<{ material: FaceMaterialId }>;
export type VoxelGeometryDefinitionV1 = Readonly<{
  version: 1;
  voxel: number;
  boxes: readonly VoxelRenderBoxV1[];
  collision: readonly VoxelGeometryBoxV1[];
  occludesFullFace: boolean;
}>;
export type VoxelGeometryRegistryV1 = Readonly<{
  get(voxel: number): VoxelGeometryDefinitionV1 | undefined;
  require(voxel: number): VoxelGeometryDefinitionV1;
  /** Frozen JSON-compatible projection for Worker and renderer consumers. */
  list(): readonly VoxelGeometryDefinitionV1[];
}>;

const record = (raw: unknown, keys: readonly string[], label: string): Record<string, unknown> => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError(`${label} is invalid.`);
  const prototype = Object.getPrototypeOf(raw);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${label} must be plain data.`);
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  if (Reflect.ownKeys(descriptors).length !== keys.length) throw new TypeError(`${label} fields are invalid.`);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !('value' in descriptor)) throw new TypeError(`${label} fields are invalid.`);
  }
  return raw as Record<string, unknown>;
};

const denseArray = <Value>(raw: unknown, label: string, minimum: number, maximum: number): readonly Value[] => {
  if (!Array.isArray(raw) || raw.length < minimum || raw.length > maximum)
    throw new TypeError(`${label} length is invalid.`);
  const keys = Reflect.ownKeys(raw).filter((key) => key !== 'length');
  if (
    keys.length !== raw.length ||
    keys.some((key, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(raw, key);
      return key !== String(index) || !descriptor?.enumerable || !('value' in descriptor);
    })
  )
    throw new TypeError(`${label} must be dense and cannot contain extra enumerable properties.`);
  return raw as readonly Value[];
};

const vector = (raw: unknown, label: string): VoxelGeometryVectorV1 => {
  const values = denseArray<number>(raw, label, 3, 3);
  if (values.some((value) => typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1))
    throw new TypeError(`${label} must contain finite coordinates within 0..1.`);
  return Object.freeze([values[0], values[1], values[2]]);
};

const geometryBox = (raw: unknown, label: string): VoxelGeometryBoxV1 => {
  const value = record(raw, ['min', 'max'], label);
  const min = vector(value.min, `${label} minimum`);
  const max = vector(value.max, `${label} maximum`);
  if (min.some((coordinate, axis) => coordinate >= max[axis]))
    throw new TypeError(`${label} must have positive extent.`);
  return Object.freeze({ min, max });
};

const renderBox = (raw: unknown, label: string): VoxelRenderBoxV1 => {
  const value = record(raw, ['min', 'max', 'material'], label);
  const shape = geometryBox({ min: value.min, max: value.max }, label);
  if (
    typeof value.material !== 'number' ||
    !Number.isSafeInteger(value.material) ||
    value.material < 1 ||
    value.material > MAX_VOXEL_FACE_MATERIAL_ID
  )
    throw new TypeError(`${label} material is invalid.`);
  return Object.freeze({ ...shape, material: value.material as FaceMaterialId });
};

const definition = (raw: unknown, index: number): VoxelGeometryDefinitionV1 => {
  const value = record(raw, ['version', 'voxel', 'boxes', 'collision', 'occludesFullFace'], `Voxel geometry ${index}`);
  if (value.version !== 1) throw new TypeError(`Voxel geometry ${index} version is invalid.`);
  if (
    typeof value.voxel !== 'number' ||
    !Number.isSafeInteger(value.voxel) ||
    value.voxel < 1 ||
    value.voxel > MAX_VOXEL_STORAGE_ID
  )
    throw new TypeError(`Voxel geometry ${index} voxel is invalid.`);
  if (typeof value.occludesFullFace !== 'boolean') throw new TypeError(`Voxel geometry ${index} occlusion is invalid.`);
  const boxes = Object.freeze(
    denseArray<unknown>(value.boxes, `Voxel geometry ${value.voxel} boxes`, 1, MAX_BOXES_PER_VOXEL).map(
      (box, boxIndex) => renderBox(box, `Voxel geometry ${value.voxel} box ${boxIndex}`),
    ),
  );
  const collision = Object.freeze(
    denseArray<unknown>(value.collision, `Voxel geometry ${value.voxel} collision`, 0, MAX_BOXES_PER_VOXEL).map(
      (box, boxIndex) => geometryBox(box, `Voxel geometry ${value.voxel} collision box ${boxIndex}`),
    ),
  );
  return Object.freeze({
    version: 1,
    voxel: value.voxel,
    boxes,
    collision,
    occludesFullFace: value.occludesFullFace,
  });
};

export function createVoxelGeometryRegistryV1(inputs: readonly VoxelGeometryDefinitionV1[]): VoxelGeometryRegistryV1 {
  const source = denseArray<unknown>(inputs, 'Voxel geometry definitions', 1, MAX_GEOMETRY_DEFINITIONS);
  const byVoxel = new Map<number, VoxelGeometryDefinitionV1>();
  for (const [index, raw] of source.entries()) {
    const value = definition(raw, index);
    if (byVoxel.has(value.voxel)) throw new TypeError(`Duplicate voxel geometry: ${value.voxel}`);
    byVoxel.set(value.voxel, value);
  }
  const values = Object.freeze([...byVoxel.values()].sort((left, right) => left.voxel - right.voxel));
  return Object.freeze({
    get: (voxel: number) => byVoxel.get(voxel),
    require: (voxel: number) => {
      const value = byVoxel.get(voxel);
      if (!value) throw new RangeError(`No voxel geometry is registered for storage ID: ${voxel}`);
      return value;
    },
    list: () => values,
  });
}

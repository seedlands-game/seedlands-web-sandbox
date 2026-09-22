import { faceMaterialFor, type FaceMaterialId } from '@seedlands/stdlib/world/voxel';
import {
  forEachVoxelGeometryFace,
  voxelModelFaceUvs,
  type VoxelModelFace,
} from '@seedlands/stdlib/world/voxel-model-mesh';
import {
  crossedPlantMaterialForVoxel,
  hasVoxelModelGeometry,
  modelBoxesForVoxel,
  type LocalBox,
} from '@seedlands/stdlib/world/voxel-model';

export type ItemMeshGroup = Readonly<{
  material: FaceMaterialId;
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
  /** Number of source geometry primitives for a model, or source faces for a full voxel. */
  boxCount: number;
}>;

export type ItemMeshDefinition = Readonly<{ groups: readonly ItemMeshGroup[] }>;

type MutableGroup = {
  material: FaceMaterialId;
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
  boxCount: number;
};

function appendFace(group: MutableGroup, box: LocalBox, dimension: number, back: boolean): void {
  const u = (dimension + 1) % 3;
  const v = (dimension + 2) % 3;
  const width = box.max[u] - box.min[u];
  const height = box.max[v] - box.min[v];
  const origin = [...box.min];
  origin[dimension] = back ? box.min[dimension] : box.max[dimension];
  const p1 = [...origin];
  p1[u] += width;
  const p2 = [...p1];
  p2[v] += height;
  const p3 = [...origin];
  p3[v] += height;
  const start = group.positions.length / 3;
  group.positions.push(...(back ? [...origin, ...p3, ...p2, ...p1] : [...origin, ...p1, ...p2, ...p3]));
  const normal = [0, 0, 0];
  normal[dimension] = back ? -1 : 1;
  group.normals.push(...normal, ...normal, ...normal, ...normal);
  const uvs =
    dimension === 0
      ? back
        ? [0, 0, height, 0, height, width, 0, width]
        : [0, 0, 0, width, height, width, height, 0]
      : back
        ? [0, 0, 0, height, width, height, width, 0]
        : [0, 0, width, 0, width, height, 0, height];
  // The world mesher stores these values in Float32Array. Quantize at the shared CPU boundary so
  // the static item definition remains exactly comparable before PlayCanvas uploads it.
  group.uvs.push(...uvs.map(Math.fround));
  group.indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
}

function appendGeometryFace(group: MutableGroup, face: VoxelModelFace): void {
  const start = group.positions.length / 3;
  group.positions.push(...face.positions);
  group.normals.push(...face.normal, ...face.normal, ...face.normal, ...face.normal);
  const uvs = voxelModelFaceUvs(face);
  group.uvs.push(...uvs.map(Math.fround));
  group.indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
}

function groupFor(groups: Map<FaceMaterialId, MutableGroup>, material: FaceMaterialId): MutableGroup {
  let group = groups.get(material);
  if (!group) {
    group = { material, positions: [], normals: [], uvs: [], indices: [], boxCount: 0 };
    groups.set(material, group);
  }
  return group;
}

/**
 * Compiles item geometry from the authoritative voxel representation. It remains CPU-only so
 * PlayCanvas mesh allocation, cache ownership, and GPU lifetime stay at the application edge.
 */
export function itemMeshDefinition(voxel: number): ItemMeshDefinition {
  const groups = new Map<FaceMaterialId, MutableGroup>();
  const modelBoxes = modelBoxesForVoxel(voxel);
  if (modelBoxes.length) {
    for (const box of modelBoxes) {
      const group = groupFor(groups, box.material);
      group.boxCount += 1;
      for (let dimension = 0; dimension < 3; dimension += 1)
        for (const back of [true, false]) appendFace(group, box, dimension, back);
    }
  } else if (hasVoxelModelGeometry(voxel)) {
    const material = crossedPlantMaterialForVoxel(voxel);
    if (material === undefined) throw new RangeError(`物品体素缺少交叉模型材质：${voxel}`);
    const group = groupFor(groups, material);
    group.boxCount = 2;
    forEachVoxelGeometryFace(voxel, [0, 0, 0], (face) => appendGeometryFace(group, face));
  } else {
    const box: LocalBox = { min: [0, 0, 0], max: [1, 1, 1] };
    for (let dimension = 0; dimension < 3; dimension += 1)
      for (const back of [true, false]) {
        const material = faceMaterialFor(voxel, dimension, !back);
        if (material === undefined) throw new RangeError(`物品体素没有面材质：${voxel}`);
        const group = groupFor(groups, material);
        group.boxCount += 1;
        appendFace(group, box, dimension, back);
      }
  }
  return { groups: [...groups.values()] };
}

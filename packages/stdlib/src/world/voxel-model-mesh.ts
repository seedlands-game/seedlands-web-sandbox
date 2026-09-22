import { CHUNK_SIZE, voxelIndex, type FaceMaterialId } from './voxel';
import { crossedPlantMaterialForVoxel, modelBoxesForVoxel } from './voxel-model';

export type VoxelModelFace = {
  material: FaceMaterialId;
  positions: number[];
  normal: number[];
  dimension: number;
  width: number;
  height: number;
  back: boolean;
  /** PixelTexture rows begin at the visual top, unlike repeating block side UVs. */
  flipV: boolean;
};

export function voxelModelFaceUvs({ dimension, width, height, back, flipV }: VoxelModelFace): number[] {
  const uvs =
    dimension === 0
      ? back
        ? [0, 0, height, 0, height, width, 0, width]
        : [0, 0, 0, width, height, width, height, 0]
      : back
        ? [0, 0, 0, height, width, height, width, 0]
        : [0, 0, width, 0, width, height, 0, height];
  return flipV ? uvs.map((value, index) => (index % 2 === 1 ? height - value : value)) : uvs;
}

export function forEachVoxelGeometryFace(
  voxel: number,
  cell: readonly [number, number, number],
  visit: (face: VoxelModelFace) => void,
): void {
  const visitBox = () => {
    for (const box of modelBoxesForVoxel(voxel)) {
      for (let dimension = 0; dimension < 3; dimension += 1) {
        const u = (dimension + 1) % 3;
        const v = (dimension + 2) % 3;
        const width = box.max[u] - box.min[u];
        const height = box.max[v] - box.min[v];
        for (const back of [true, false]) {
          const origin = [cell[0] + box.min[0], cell[1] + box.min[1], cell[2] + box.min[2]];
          origin[dimension] = cell[dimension] + (back ? box.min[dimension] : box.max[dimension]);
          const p1 = [...origin];
          p1[u] += width;
          const p2 = [...p1];
          p2[v] += height;
          const p3 = [...origin];
          p3[v] += height;
          const normal = [0, 0, 0];
          normal[dimension] = back ? -1 : 1;
          visit({
            material: box.material,
            positions: back ? [...origin, ...p3, ...p2, ...p1] : [...origin, ...p1, ...p2, ...p3],
            normal,
            dimension,
            width,
            height,
            back,
            flipV: false,
          });
        }
      }
    }
  };
  const visitCrossedPlant = () => {
    const material = crossedPlantMaterialForVoxel(voxel);
    if (material === undefined) return;
    const x = cell[0],
      y = cell[1],
      z = cell[2];
    const planes: readonly [readonly number[], readonly [number, number, number]][] = [
      [
        [x, y, z, x + 1, y, z + 1, x + 1, y + 1, z + 1, x, y + 1, z],
        [-Math.SQRT1_2, 0, Math.SQRT1_2],
      ],
      [
        [x, y, z + 1, x + 1, y, z, x + 1, y + 1, z, x, y + 1, z + 1],
        [Math.SQRT1_2, 0, Math.SQRT1_2],
      ],
    ];
    for (const [front, normal] of planes) {
      visit({
        material,
        positions: [...front],
        normal: [...normal],
        dimension: 1,
        width: 1,
        height: 1,
        back: false,
        flipV: true,
      });
      visit({
        material,
        positions: [...front.slice(0, 3), ...front.slice(9, 12), ...front.slice(6, 9), ...front.slice(3, 6)],
        normal: normal.map((value) => -value),
        dimension: 1,
        width: 1,
        height: 1,
        back: true,
        flipV: true,
      });
    }
  };
  visitBox();
  visitCrossedPlant();
}

export function forEachVoxelModelFace(data: Uint16Array, visit: (face: VoxelModelFace) => void): void {
  for (let y = 0; y < CHUNK_SIZE; y += 1)
    for (let z = 0; z < CHUNK_SIZE; z += 1)
      for (let x = 0; x < CHUNK_SIZE; x += 1) forEachVoxelGeometryFace(data[voxelIndex(x, y, z)], [x, y, z], visit);
}

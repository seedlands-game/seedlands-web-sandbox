import { CHUNK_SIZE, voxelIndex, type FaceMaterialId } from './voxel';
import { modelBoxesForVoxel } from './voxel-model';

export type VoxelModelFace = {
  material: FaceMaterialId;
  positions: number[];
  normal: number[];
  dimension: number;
  width: number;
  height: number;
  back: boolean;
};

export function forEachVoxelModelFace(data: Uint16Array, visit: (face: VoxelModelFace) => void): void {
  const visitBox = (cell: readonly [number, number, number], voxel: number) => {
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
          });
        }
      }
    }
  };
  for (let y = 0; y < CHUNK_SIZE; y += 1)
    for (let z = 0; z < CHUNK_SIZE; z += 1)
      for (let x = 0; x < CHUNK_SIZE; x += 1) visitBox([x, y, z], data[voxelIndex(x, y, z)]);
}

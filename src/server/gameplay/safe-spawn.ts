import { Voxel } from '../../world/voxel';

const ground = new Set<number>([Voxel.Grass, Voxel.Dirt, Voxel.Stone, Voxel.Sand, Voxel.Snow]);
const MAX_HEIGHT = 128;
const MAX_RADIUS = 64;
const STEP = 4;

/** 只读取世界，固定遍历次序；失败显式返回 null，不能清空地形制造出生点。 */
export function findSafePlayerSpawn(
  getVoxel: (x: number, y: number, z: number) => number,
): [number, number, number] | null {
  const column = (x: number, z: number): [number, number, number] | null => {
    let headroom = 0;
    for (let y = MAX_HEIGHT; y >= 0; y--) {
      const voxel = getVoxel(x, y, z);
      if (voxel === Voxel.Air) {
        headroom++;
        continue;
      }
      if (ground.has(voxel) && headroom >= 2) return [x + 0.5, y + 2.6, z + 0.5];
      // 第一处非空气是水/树/顶壁时，该列不可作为可靠地面。
      return null;
    }
    return null;
  };
  const origin = column(0, 0);
  if (origin) return origin;
  for (let radius = STEP; radius <= MAX_RADIUS; radius += STEP) {
    for (let x = -radius; x <= radius; x += STEP)
      for (const z of [-radius, radius]) {
        const result = column(x, z);
        if (result) return result;
      }
    for (let z = -radius + STEP; z < radius; z += STEP)
      for (const x of [-radius, radius]) {
        const result = column(x, z);
        if (result) return result;
      }
  }
  return null;
}

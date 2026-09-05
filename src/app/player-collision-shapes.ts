import { collisionBoxesForVoxel } from '../world/voxel-model';

export const PLAYER_HALF_WIDTH = 0.32;
export const PLAYER_FEET_OFFSET = 1.6;
export const PLAYER_HEAD_OFFSET = 0.2;
export const COLLISION_EPSILON = 0.001;

type Position = { x: number; y: number; z: number };
type VoxelSource = { getVoxel: (x: number, y: number, z: number) => number };

const playerBounds = (position: Position) => ({
  minX: position.x - PLAYER_HALF_WIDTH,
  maxX: position.x + PLAYER_HALF_WIDTH,
  minY: position.y - PLAYER_FEET_OFFSET + COLLISION_EPSILON,
  maxY: position.y + PLAYER_HEAD_OFFSET - COLLISION_EPSILON,
  minZ: position.z - PLAYER_HALF_WIDTH,
  maxZ: position.z + PLAYER_HALF_WIDTH,
});

export function playerCollisionOverlap(world: VoxelSource, position: Position): number {
  const { minX, maxX, minY, maxY, minZ, maxZ } = playerBounds(position);
  let overlap = 0;
  for (let x = Math.floor(minX); x <= Math.floor(maxX - COLLISION_EPSILON); x += 1) {
    for (let y = Math.floor(minY); y <= Math.floor(maxY - COLLISION_EPSILON); y += 1) {
      for (let z = Math.floor(minZ); z <= Math.floor(maxZ - COLLISION_EPSILON); z += 1) {
        for (const box of collisionBoxesForVoxel(world.getVoxel(x, y, z))) {
          const overlapX = Math.min(maxX, x + box.max[0]) - Math.max(minX, x + box.min[0]);
          const overlapY = Math.min(maxY, y + box.max[1]) - Math.max(minY, y + box.min[1]);
          const overlapZ = Math.min(maxZ, z + box.max[2]) - Math.max(minZ, z + box.min[2]);
          if (overlapX > 0 && overlapY > 0 && overlapZ > 0) overlap += overlapX * overlapY * overlapZ;
        }
      }
    }
  }
  return overlap;
}

export function playerHorizontalDepenetration(world: VoxelSource, position: Position): { x: number; z: number } | null {
  if (playerCollisionOverlap(world, position) === 0) return null;
  const { minX, maxX, minY, maxY, minZ, maxZ } = playerBounds(position);
  let left = Infinity,
    right = -Infinity,
    backward = Infinity,
    forward = -Infinity;
  for (let x = Math.floor(minX); x <= Math.floor(maxX - COLLISION_EPSILON); x += 1)
    for (let y = Math.floor(minY); y <= Math.floor(maxY - COLLISION_EPSILON); y += 1)
      for (let z = Math.floor(minZ); z <= Math.floor(maxZ - COLLISION_EPSILON); z += 1) {
        for (const box of collisionBoxesForVoxel(world.getVoxel(x, y, z))) {
          const boxMinX = x + box.min[0];
          const boxMaxX = x + box.max[0];
          const boxMinY = y + box.min[1];
          const boxMaxY = y + box.max[1];
          const boxMinZ = z + box.min[2];
          const boxMaxZ = z + box.max[2];
          if (
            boxMaxY <= minY ||
            boxMinY >= maxY ||
            boxMaxX <= minX ||
            boxMinX >= maxX ||
            boxMaxZ <= minZ ||
            boxMinZ >= maxZ
          )
            continue;
          left = Math.min(left, boxMinX - maxX - COLLISION_EPSILON);
          right = Math.max(right, boxMaxX - minX + COLLISION_EPSILON);
          backward = Math.min(backward, boxMinZ - maxZ - COLLISION_EPSILON);
          forward = Math.max(forward, boxMaxZ - minZ + COLLISION_EPSILON);
        }
      }
  return (
    [
      [left, 0],
      [right, 0],
      [0, backward],
      [0, forward],
    ]
      .filter(([x, z]) => Number.isFinite(x) && Number.isFinite(z))
      .map(([x, z]) => ({ x, z, distance: Math.abs(x) + Math.abs(z) }))
      .sort((a, b) => a.distance - b.distance)
      .find(
        ({ x, z }) => playerCollisionOverlap(world, { x: position.x + x, y: position.y, z: position.z + z }) === 0,
      ) ?? null
  );
}

export function playerCeilingBottom(world: VoxelSource, position: Position, y: number): number | null {
  const head = position.y + PLAYER_HEAD_OFFSET - COLLISION_EPSILON;
  let bottom: number | null = null;
  for (const x of [position.x - PLAYER_HALF_WIDTH, position.x + PLAYER_HALF_WIDTH])
    for (const z of [position.z - PLAYER_HALF_WIDTH, position.z + PLAYER_HALF_WIDTH])
      for (const box of collisionBoxesForVoxel(world.getVoxel(Math.floor(x), y, Math.floor(z)))) {
        const localX = x - Math.floor(x);
        const localZ = z - Math.floor(z);
        const boxBottom = y + box.min[1];
        const boxTop = y + box.max[1];
        if (
          localX >= box.min[0] &&
          localX <= box.max[0] &&
          localZ >= box.min[2] &&
          localZ <= box.max[2] &&
          head >= boxBottom &&
          head < boxTop
        )
          bottom = bottom === null ? boxBottom : Math.min(bottom, boxBottom);
      }
  return bottom;
}

export function playerGroundSupportTop(world: VoxelSource, position: Position, y: number): number | null {
  const voxelX = Math.floor(position.x);
  const voxelZ = Math.floor(position.z);
  const localX = position.x - voxelX;
  const localZ = position.z - voxelZ;
  const feet = position.y - PLAYER_FEET_OFFSET + COLLISION_EPSILON;
  let top: number | null = null;
  for (const box of collisionBoxesForVoxel(world.getVoxel(voxelX, y, voxelZ))) {
    const boxTop = y + box.max[1];
    if (localX >= box.min[0] && localX <= box.max[0] && localZ >= box.min[2] && localZ <= box.max[2] && feet <= boxTop)
      top = top === null ? boxTop : Math.max(top, boxTop);
  }
  return top;
}

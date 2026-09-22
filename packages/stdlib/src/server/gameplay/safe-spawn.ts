import { isSolid, Voxel } from '../../world/voxel';
import { bodyConfigFor } from '../../physics/body-registry';
import type { VoxelSemanticsResolver } from '../../world/voxel-semantics';
import { voxelIsPassable, voxelIsSolid } from '../../world/voxel-semantics';

const ground = new Set<number>([Voxel.Grass, Voxel.Dirt, Voxel.Stone, Voxel.Sand, Voxel.Snow]);
const MAX_HEIGHT = 128;
const MAX_RADIUS = 64;
const STEP = 4;
const SCORED_RADIUS = 16;
const OPEN_ROUTE_LENGTH = 6;
const TREE_SEARCH_RADIUS = 8;
const LOW_CEILING_RADIUS = 2;
const LOW_CEILING_HEIGHT = 3;
const playerBody = bodyConfigFor('player').localAabb;
const requiredHeadroom = Math.ceil(playerBody.max.y - playerBody.min.y);
const passableSpawnDecoration = new Set<number>([
  Voxel.Sapling,
  Voxel.TallGrass,
  Voxel.Flower,
  Voxel.Mushroom,
  Voxel.SugarCane,
  Voxel.DeadBush,
  Voxel.RedFlower,
  Voxel.RedMushroom,
]);
type VoxelReader = (x: number, y: number, z: number) => number;
type SpawnCandidate = Readonly<{
  x: number;
  groundY: number;
  z: number;
  position: [number, number, number];
}>;
type ScoredSpawnCandidate = SpawnCandidate &
  Readonly<{
    openDirections: number;
    openSteps: number;
    nearestTreeDistanceSquared: number;
    lowCeilingBlocks: number;
    distanceSquared: number;
  }>;

const candidateCoordinates = function* (): Generator<readonly [number, number]> {
  yield [0, 0];
  for (let radius = STEP; radius <= MAX_RADIUS; radius += STEP) {
    for (let x = -radius; x <= radius; x += STEP) for (const z of [-radius, radius] as const) yield [x, z];
    for (let z = -radius + STEP; z < radius; z += STEP) for (const x of [-radius, radius] as const) yield [x, z];
  }
};

const safeColumn = (
  getVoxel: VoxelReader,
  x: number,
  z: number,
  passThroughDecoration = false,
  semantics?: VoxelSemanticsResolver,
): SpawnCandidate | null => {
  let headroom = 0;
  for (let y = MAX_HEIGHT; y >= 0; y--) {
    const voxel = getVoxel(x, y, z);
    if (
      (semantics ? voxelIsPassable(voxel, semantics) : voxel === Voxel.Air) ||
      (!semantics && passThroughDecoration && passableSpawnDecoration.has(voxel))
    ) {
      headroom++;
      continue;
    }
    if ((semantics ? voxelIsSolid(voxel, semantics) : ground.has(voxel)) && headroom >= requiredHeadroom)
      return { x, groundY: y, z, position: [x + 0.5, y + 1 - playerBody.min.y, z + 0.5] };
    // 第一处非空气是水/树/顶壁时，该列不可作为可靠地面。
    return null;
  }
  return null;
};

const walkableGroundY = (
  getVoxel: VoxelReader,
  x: number,
  previousGroundY: number,
  z: number,
  semantics?: VoxelSemanticsResolver,
): number | null => {
  for (const candidateGroundY of [previousGroundY + 1, previousGroundY, previousGroundY - 1]) {
    if (
      semantics
        ? !voxelIsSolid(getVoxel(x, candidateGroundY, z), semantics)
        : !ground.has(getVoxel(x, candidateGroundY, z))
    )
      continue;
    let clear = true;
    for (let height = 1; height <= requiredHeadroom; height += 1) {
      const voxel = getVoxel(x, candidateGroundY + height, z);
      if (
        !(semantics ? voxelIsPassable(voxel, semantics) : voxel === Voxel.Air) &&
        !(!semantics && passableSpawnDecoration.has(voxel))
      ) {
        clear = false;
        break;
      }
    }
    if (clear) return candidateGroundY;
  }
  return null;
};

const routeScore = (getVoxel: VoxelReader, candidate: SpawnCandidate, semantics?: VoxelSemanticsResolver) => {
  let openDirections = 0;
  let openSteps = 0;
  for (const [dx, dz] of [
    [-1, -1],
    [-1, 0],
    [-1, 1],
    [0, -1],
    [0, 1],
    [1, -1],
    [1, 0],
    [1, 1],
  ] as const) {
    let steps = 0;
    let groundY = candidate.groundY;
    while (steps < OPEN_ROUTE_LENGTH) {
      const nextGroundY = walkableGroundY(
        getVoxel,
        candidate.x + dx * (steps + 1),
        groundY,
        candidate.z + dz * (steps + 1),
        semantics,
      );
      if (nextGroundY === null) break;
      groundY = nextGroundY;
      steps++;
    }
    openSteps += steps;
    if (steps === OPEN_ROUTE_LENGTH) openDirections++;
  }
  return { openDirections, openSteps };
};

export const countOpenSpawnDirections = (getVoxel: VoxelReader, x: number, groundY: number, z: number): number =>
  routeScore(getVoxel, { x, groundY, z, position: [x + 0.5, groundY + 1 - playerBody.min.y, z + 0.5] }).openDirections;

const nearbyTreeDistanceSquared = (getVoxel: VoxelReader, candidate: SpawnCandidate) => {
  const maximum = TREE_SEARCH_RADIUS * TREE_SEARCH_RADIUS;
  let nearest = maximum;
  for (let dx = -TREE_SEARCH_RADIUS; dx <= TREE_SEARCH_RADIUS; dx += 1)
    for (let dz = -TREE_SEARCH_RADIUS; dz <= TREE_SEARCH_RADIUS; dz += 1) {
      const distanceSquared = dx * dx + dz * dz;
      if (distanceSquared >= nearest || distanceSquared > maximum) continue;
      for (let y = candidate.groundY; y <= candidate.groundY + TREE_SEARCH_RADIUS; y += 1)
        if (getVoxel(candidate.x + dx, y, candidate.z + dz) === Voxel.Wood) {
          nearest = distanceSquared;
          break;
        }
    }
  return nearest;
};

const lowCeilingBlocks = (getVoxel: VoxelReader, candidate: SpawnCandidate, semantics?: VoxelSemanticsResolver) => {
  let blocks = 0;
  for (let dx = -LOW_CEILING_RADIUS; dx <= LOW_CEILING_RADIUS; dx += 1)
    for (let dz = -LOW_CEILING_RADIUS; dz <= LOW_CEILING_RADIUS; dz += 1)
      for (
        let y = candidate.groundY + requiredHeadroom + 1;
        y < candidate.groundY + requiredHeadroom + LOW_CEILING_HEIGHT + 1;
        y += 1
      )
        if (
          semantics
            ? voxelIsSolid(getVoxel(candidate.x + dx, y, candidate.z + dz), semantics)
            : isSolid(getVoxel(candidate.x + dx, y, candidate.z + dz))
        )
          blocks++;
  return blocks;
};

const scoreCandidate = (
  getVoxel: VoxelReader,
  candidate: SpawnCandidate,
  semantics?: VoxelSemanticsResolver,
): ScoredSpawnCandidate => ({
  ...candidate,
  ...routeScore(getVoxel, candidate, semantics),
  nearestTreeDistanceSquared: nearbyTreeDistanceSquared(getVoxel, candidate),
  lowCeilingBlocks: lowCeilingBlocks(getVoxel, candidate, semantics),
  distanceSquared: candidate.x * candidate.x + candidate.z * candidate.z,
});

const compareScoredCandidates = (left: ScoredSpawnCandidate, right: ScoredSpawnCandidate): number =>
  right.openDirections - left.openDirections ||
  right.openSteps - left.openSteps ||
  right.nearestTreeDistanceSquared - left.nearestTreeDistanceSquared ||
  left.lowCeilingBlocks - right.lowCeilingBlocks ||
  left.distanceSquared - right.distanceSquared ||
  left.x - right.x ||
  left.z - right.z ||
  left.groundY - right.groundY;

/** 只读取世界，固定遍历次序；失败显式返回 null，不能清空地形制造出生点。 */
export function findSafePlayerSpawn(
  getVoxel: VoxelReader,
  generatorVersion: number,
  semantics?: VoxelSemanticsResolver,
): [number, number, number] | null {
  if (generatorVersion < 11) {
    for (const [x, z] of candidateCoordinates()) {
      const candidate = safeColumn(getVoxel, x, z, false, semantics);
      if (candidate) return candidate.position;
    }
    return null;
  }
  let best: ScoredSpawnCandidate | null = null;
  for (const [x, z] of candidateCoordinates()) {
    if (Math.max(Math.abs(x), Math.abs(z)) > SCORED_RADIUS) break;
    const candidate = safeColumn(getVoxel, x, z, true, semantics);
    if (!candidate) continue;
    const scored = scoreCandidate(getVoxel, candidate, semantics);
    if (!best || compareScoredCandidates(scored, best) < 0) best = scored;
  }
  if (best) return best.position;
  // 极端地形仍保留旧的半径 64 确定性兜底，但不为远处每个候选执行高成本景观评分。
  for (const [x, z] of candidateCoordinates()) {
    if (Math.max(Math.abs(x), Math.abs(z)) <= SCORED_RADIUS) continue;
    const candidate = safeColumn(getVoxel, x, z, true, semantics);
    if (candidate) return candidate.position;
  }
  return null;
}

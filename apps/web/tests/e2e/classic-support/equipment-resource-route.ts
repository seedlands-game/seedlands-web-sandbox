import { reachedRouteTarget, type RouteDirection } from './route-progress';
import { voxelInteractionDistance } from './target-aim';
import type { Point, RoutePoint } from './scenario';

export const EQUIPMENT_RESOURCE_ROUTE_OPTIONS = Object.freeze({
  tolerance: 0.06,
  corridorTolerance: 0.08,
  pulseMs: 80,
});
export const EQUIPMENT_RESOURCE_WALK_OPTIONS = Object.freeze({
  ...EQUIPMENT_RESOURCE_ROUTE_OPTIONS,
  jump: false,
});
export const EQUIPMENT_ROUTE_TIMEOUT_MS = 45_000;
// Matches mineVoxel's existing approach tolerance, contains one 80ms pulse (max 0.36m),
// and leaves 0.73m before the next resource's player-expanded AABB.
export const EQUIPMENT_ROUTE_MAX_X_ERROR = 0.45;

export type EquipmentRouteSnapshot = Readonly<{
  player: Point;
  serverPlayerPosition: Point;
  onGround: boolean;
  colliding: boolean;
  authority: Readonly<{ physicsTick: number; acknowledgedInputSequence: number }>;
}>;

export type EquipmentRouteObstacle = Readonly<{ position: Point }>;
export type EquipmentRouteDriver = Readonly<{
  now(): number;
  observe(): Promise<EquipmentRouteSnapshot | null>;
  walk(direction: RouteDirection, timeoutMs: number): Promise<EquipmentRouteSnapshot>;
  waitForArrival(
    baseline: EquipmentRouteSnapshot,
    direction: RouteDirection,
    timeoutMs: number,
  ): Promise<EquipmentRouteSnapshot>;
}>;

export const equipmentRouteDirection = (position: Point, target: RoutePoint): RouteDirection =>
  position[0] <= target[0] ? 'KeyW' : 'KeyS';

export const equipmentWorkbenchCorridor = (workbenchApproach: RoutePoint): RoutePoint => [workbenchApproach[0], -0.5];

export const equipmentResourcePickup = (placement: Readonly<{ target: Point }>): RoutePoint => [
  placement.target[0] + 0.5,
  placement.target[2] + 0.5,
];

export const equipmentWorkbenchMiningApproach = (
  workbench: Readonly<{ target: Point; approach: RoutePoint }>,
): RoutePoint => [workbench.target[0] + 0.5, workbench.approach[1] + 1];

export const isInsideEquipmentRouteNeighborhood = (position: Point, target: RoutePoint): boolean =>
  Math.abs(position[0] - target[0]) <= EQUIPMENT_ROUTE_MAX_X_ERROR &&
  Math.abs(position[2] - target[1]) < EQUIPMENT_RESOURCE_ROUTE_OPTIONS.corridorTolerance;

export function matchesEquipmentRouteArrival(
  baseline: EquipmentRouteSnapshot,
  current: EquipmentRouteSnapshot,
  target: RoutePoint,
  direction: RouteDirection,
): boolean {
  return (
    current.onGround &&
    !current.colliding &&
    current.authority.physicsTick > baseline.authority.physicsTick &&
    current.authority.acknowledgedInputSequence >= baseline.authority.acknowledgedInputSequence &&
    isInsideEquipmentRouteNeighborhood(current.player, target) &&
    isInsideEquipmentRouteNeighborhood(current.serverPlayerPosition, target) &&
    reachedRouteTarget(
      current.player,
      target,
      direction,
      EQUIPMENT_RESOURCE_ROUTE_OPTIONS.tolerance,
      EQUIPMENT_RESOURCE_ROUTE_OPTIONS.corridorTolerance,
    ) &&
    reachedRouteTarget(
      current.serverPlayerPosition,
      target,
      direction,
      EQUIPMENT_RESOURCE_ROUTE_OPTIONS.tolerance,
      EQUIPMENT_RESOURCE_ROUTE_OPTIONS.corridorTolerance,
    )
  );
}

export async function followEquipmentRoute(
  target: RoutePoint,
  driver: EquipmentRouteDriver,
): Promise<EquipmentRouteSnapshot> {
  const deadline = driver.now() + EQUIPMENT_ROUTE_TIMEOUT_MS;
  let baseline = await driver.observe();
  if (!baseline) throw new Error('Classic snapshot is unavailable before the equipment route.');
  while (driver.now() < deadline) {
    const direction = equipmentRouteDirection(baseline.player, target);
    const remainingBeforeWalk = deadline - driver.now();
    if (remainingBeforeWalk <= 0) break;
    const walked = await driver.walk(direction, remainingBeforeWalk);
    if (driver.now() >= deadline) break;
    if (matchesEquipmentRouteArrival(baseline, walked, target, direction)) return walked;
    if (
      isInsideEquipmentRouteNeighborhood(walked.player, target) &&
      reachedRouteTarget(
        walked.player,
        target,
        direction,
        EQUIPMENT_RESOURCE_ROUTE_OPTIONS.tolerance,
        EQUIPMENT_RESOURCE_ROUTE_OPTIONS.corridorTolerance,
      )
    ) {
      const remaining = Math.min(20_000, deadline - driver.now());
      if (remaining <= 0) break;
      const matched = await driver.waitForArrival(baseline, direction, remaining);
      if (driver.now() >= deadline) break;
      if (!matchesEquipmentRouteArrival(baseline, matched, target, direction))
        throw new Error('Equipment route wait returned a non-matching snapshot.');
      return matched;
    }
    baseline = walked;
  }
  throw new Error(`Equipment route timed out before ${target.join(',')}.`);
}

export const isEquipmentMiningReady = (snapshot: EquipmentRouteSnapshot, target: Point): boolean =>
  snapshot.onGround &&
  !snapshot.colliding &&
  [snapshot.player, snapshot.serverPlayerPosition].every((position) => {
    const distance = voxelInteractionDistance(position, target);
    return distance >= 2.5 && distance <= 4.5;
  });

export function equipmentRouteSegmentClearsVoxels(
  from: RoutePoint,
  to: RoutePoint,
  obstacles: readonly EquipmentRouteObstacle[],
  playerHalfWidth: number,
): boolean {
  if (!Number.isFinite(playerHalfWidth) || playerHalfWidth <= 0) return false;
  return obstacles.every(({ position }) => {
    const minimum: RoutePoint = [position[0] - playerHalfWidth, position[2] - playerHalfWidth];
    const maximum: RoutePoint = [position[0] + 1 + playerHalfWidth, position[2] + 1 + playerHalfWidth];
    let entry = 0;
    let exit = 1;
    for (const axis of [0, 1] as const) {
      const delta = to[axis] - from[axis];
      if (delta === 0) {
        if (from[axis] < minimum[axis] || from[axis] > maximum[axis]) return true;
        continue;
      }
      const first = (minimum[axis] - from[axis]) / delta;
      const second = (maximum[axis] - from[axis]) / delta;
      entry = Math.max(entry, Math.min(first, second));
      exit = Math.min(exit, Math.max(first, second));
      if (entry > exit) return true;
    }
    return entry > exit || exit < 0 || entry > 1;
  });
}

export function equipmentRouteNeighborhoodClearsVoxels(
  from: RoutePoint,
  to: RoutePoint,
  obstacles: readonly EquipmentRouteObstacle[],
  playerHalfWidth: number,
): boolean {
  if (!Number.isFinite(playerHalfWidth) || playerHalfWidth <= 0) return false;
  const minimum: RoutePoint = [
    Math.min(from[0], to[0]) - EQUIPMENT_ROUTE_MAX_X_ERROR,
    Math.min(from[1], to[1]) - EQUIPMENT_RESOURCE_ROUTE_OPTIONS.corridorTolerance,
  ];
  const maximum: RoutePoint = [
    Math.max(from[0], to[0]) + EQUIPMENT_ROUTE_MAX_X_ERROR,
    Math.max(from[1], to[1]) + EQUIPMENT_RESOURCE_ROUTE_OPTIONS.corridorTolerance,
  ];
  return obstacles.every(({ position }) => {
    const obstacleMinimum: RoutePoint = [position[0] - playerHalfWidth, position[2] - playerHalfWidth];
    const obstacleMaximum: RoutePoint = [position[0] + 1 + playerHalfWidth, position[2] + 1 + playerHalfWidth];
    return (
      maximum[0] < obstacleMinimum[0] ||
      minimum[0] > obstacleMaximum[0] ||
      maximum[1] < obstacleMinimum[1] ||
      minimum[1] > obstacleMaximum[1]
    );
  });
}

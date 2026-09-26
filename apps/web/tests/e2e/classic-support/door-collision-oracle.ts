import type { VoxelGeometryBoxV1 } from '@seedlands/stdlib/mod-api';
import { COLLISION_EPSILON } from '@seedlands/stdlib/physics/geometry';
import type { Point, RoutePoint } from './scenario';

const ALIGNMENT_MARGIN = COLLISION_EPSILON * 4;
const APPROACH_DISTANCE = 1;
const CONTACT_TOLERANCE = COLLISION_EPSILON * 4;
const MINIMUM_PROGRESS = 0.25;
const MINIMUM_BLOCKED_TICKS = 6;

type HorizontalAxis = 0 | 2;

export type ClosedDoorProbeObservation = Readonly<{
  position: Point;
  acknowledgedInputSequence: number;
  physicsTick: number;
  onGround: boolean;
  colliding: boolean;
}>;

export type ClosedDoorProbePlan = Readonly<{
  normalAxis: HorizontalAxis;
  lateralAxis: HorizontalAxis;
  direction: -1 | 1;
  contact: number;
  approach: RoutePoint;
  routeTarget: RoutePoint;
  safeLateral: readonly [number, number];
}>;

export type ClosedDoorProbeAssessment =
  | Readonly<{ status: 'blocked' }>
  | Readonly<{
      status: 'pending';
      reason: 'no-observations' | 'stale-input' | 'insufficient-progress' | 'insufficient-contact-hold';
    }>
  | Readonly<{
      status: 'invalid';
      reason: 'body-not-ready' | 'not-before-door' | 'outside-safe-corridor' | 'crossed-contact-plane';
    }>;

export type DoorRouteReadinessSnapshot = Readonly<{
  player: Point;
  serverPlayerPosition: Point;
  onGround: boolean;
  colliding: boolean;
  authority: Readonly<{ physicsTick: number; acknowledgedInputSequence: number }>;
}>;

const horizontalCoordinate = (point: Point, axis: HorizontalAxis) => point[axis];
const routePoint = (normalAxis: HorizontalAxis, normal: number, lateral: number): RoutePoint =>
  normalAxis === 0 ? [normal, lateral] : [lateral, normal];
const finitePoint = (point: Point) => point.every(Number.isFinite);

export function createClosedDoorProbePlan(
  options: Readonly<{
    door: Point;
    collision: VoxelGeometryBoxV1;
    playerPosition: Point;
    playerHalfWidth: number;
  }>,
): ClosedDoorProbePlan {
  const { door, collision, playerPosition, playerHalfWidth } = options;
  if (!finitePoint(door) || !finitePoint(playerPosition) || !Number.isFinite(playerHalfWidth) || playerHalfWidth <= 0)
    throw new TypeError('Closed-door probe inputs must be finite and the player half-width must be positive.');
  const xExtent = collision.max[0] - collision.min[0];
  const zExtent = collision.max[2] - collision.min[2];
  if (!(xExtent > 0) || !(zExtent > 0) || xExtent === zExtent)
    throw new TypeError('Closed-door collision must have one distinct horizontal thin axis.');
  const normalAxis: HorizontalAxis = xExtent < zExtent ? 0 : 2;
  const lateralAxis: HorizontalAxis = normalAxis === 0 ? 2 : 0;
  const worldMinimum = door[normalAxis] + collision.min[normalAxis];
  const worldMaximum = door[normalAxis] + collision.max[normalAxis];
  const direction: -1 | 1 =
    horizontalCoordinate(playerPosition, normalAxis) < (worldMinimum + worldMaximum) / 2 ? 1 : -1;
  const contact = (direction === 1 ? worldMinimum : worldMaximum) - direction * playerHalfWidth;
  const lateralMinimum = door[lateralAxis] + collision.min[lateralAxis] + playerHalfWidth + ALIGNMENT_MARGIN;
  const lateralMaximum = door[lateralAxis] + collision.max[lateralAxis] - playerHalfWidth - ALIGNMENT_MARGIN;
  if (lateralMinimum >= lateralMaximum) throw new TypeError('Closed-door collision is too narrow for a safe probe.');
  const lateralCenter = (lateralMinimum + lateralMaximum) / 2;
  return Object.freeze({
    normalAxis,
    lateralAxis,
    direction,
    contact,
    approach: routePoint(normalAxis, contact - direction * APPROACH_DISTANCE, lateralCenter),
    routeTarget: routePoint(normalAxis, contact + direction * APPROACH_DISTANCE, lateralCenter),
    safeLateral: Object.freeze([lateralMinimum, lateralMaximum] as const),
  });
}

export function doorEntryAdjacent(plan: ClosedDoorProbePlan, target: Point): Point {
  if (!finitePoint(target) || !target.every(Number.isInteger))
    throw new TypeError('Door entry target must contain finite integer coordinates.');
  const adjacent = [...target] as [number, number, number];
  adjacent[plan.normalAxis] -= plan.direction;
  return Object.freeze(adjacent);
}

export function doorExitAdjacent(plan: ClosedDoorProbePlan, target: Point): Point {
  if (!finitePoint(target) || !target.every(Number.isInteger))
    throw new TypeError('Door exit target must contain finite integer coordinates.');
  const adjacent = [...target] as [number, number, number];
  adjacent[plan.normalAxis] += plan.direction;
  return Object.freeze(adjacent);
}

export function isOutsideDoorTargetOnEntrySide(plan: ClosedDoorProbePlan, target: Point, position: Point): boolean {
  if (!finitePoint(target) || !finitePoint(position)) return false;
  const nearBoundary = target[plan.normalAxis] + (plan.direction === 1 ? 0 : 1);
  return plan.direction * (position[plan.normalAxis] - nearBoundary) < 0;
}

export function isOutsideDoorTargetOnExitSide(plan: ClosedDoorProbePlan, target: Point, position: Point): boolean {
  if (!finitePoint(target) || !finitePoint(position)) return false;
  const exitBoundary = target[plan.normalAxis] + (plan.direction === 1 ? 1 : 0);
  return plan.direction * (position[plan.normalAxis] - exitBoundary) > 0;
}

export function matchesDoorRouteReadinessSnapshot(
  plan: ClosedDoorProbePlan,
  target: Point,
  side: 'entry' | 'exit',
  baseline: DoorRouteReadinessSnapshot,
  current: DoorRouteReadinessSnapshot,
): boolean {
  const isOutside = side === 'entry' ? isOutsideDoorTargetOnEntrySide : isOutsideDoorTargetOnExitSide;
  return (
    current.onGround &&
    !current.colliding &&
    current.authority.physicsTick > baseline.authority.physicsTick &&
    current.authority.acknowledgedInputSequence >= baseline.authority.acknowledgedInputSequence &&
    isOutside(plan, target, current.player) &&
    isOutside(plan, target, current.serverPlayerPosition)
  );
}

export function assessClosedDoorProbe(
  plan: ClosedDoorProbePlan,
  before: ClosedDoorProbeObservation,
  observations: readonly ClosedDoorProbeObservation[],
): ClosedDoorProbeAssessment {
  const all = [before, ...observations];
  if (!before.onGround || before.colliding) return { status: 'invalid', reason: 'body-not-ready' };
  if (
    all.some(({ position }) => {
      const lateral = horizontalCoordinate(position, plan.lateralAxis);
      return lateral < plan.safeLateral[0] || lateral > plan.safeLateral[1];
    })
  )
    return { status: 'invalid', reason: 'outside-safe-corridor' };
  if (plan.direction * (plan.contact - horizontalCoordinate(before.position, plan.normalAxis)) <= MINIMUM_PROGRESS)
    return { status: 'invalid', reason: 'not-before-door' };
  if (!observations.length) return { status: 'pending', reason: 'no-observations' };
  const signedContactOffsets = observations.map(
    ({ position }) => plan.direction * (horizontalCoordinate(position, plan.normalAxis) - plan.contact),
  );
  if (signedContactOffsets.some((offset) => offset > CONTACT_TOLERANCE))
    return { status: 'invalid', reason: 'crossed-contact-plane' };
  if (
    observations.every(({ acknowledgedInputSequence }) => acknowledgedInputSequence <= before.acknowledgedInputSequence)
  )
    return { status: 'pending', reason: 'stale-input' };
  const progress = Math.max(
    ...observations.map(
      ({ position }) =>
        plan.direction *
        (horizontalCoordinate(position, plan.normalAxis) - horizontalCoordinate(before.position, plan.normalAxis)),
    ),
  );
  if (progress < MINIMUM_PROGRESS) return { status: 'pending', reason: 'insufficient-progress' };
  const contactIndex = signedContactOffsets.findIndex((offset) => offset >= -CONTACT_TOLERANCE);
  if (contactIndex < 0) return { status: 'pending', reason: 'insufficient-progress' };
  const contactObservations = observations.slice(contactIndex);
  if (contactObservations.some((_, index) => signedContactOffsets[contactIndex + index]! < -CONTACT_TOLERANCE))
    return { status: 'pending', reason: 'insufficient-contact-hold' };
  if (contactObservations.at(-1)!.physicsTick - contactObservations[0]!.physicsTick < MINIMUM_BLOCKED_TICKS)
    return { status: 'pending', reason: 'insufficient-contact-hold' };
  return { status: 'blocked' };
}

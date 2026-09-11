import { bodyConfigFor, bodyKindForEntity, CollisionLayer } from '../../physics/body-registry';
import type { LocalAabb, WorldAabb } from '../../physics/types';
import type { GameplayEntity } from '../gameplay/entity-store';
import type { NavigationConstraint, NavigationPosition } from './ground-navigator';
import type { PerceptionSnapshot } from './perception-runtime';

const MAX_LOCAL_BODY_OBSTACLES = 64;
const CONTACT_EPSILON = 1e-6;

type NavigationEntity = Pick<GameplayEntity, 'id' | 'type' | 'archetype' | 'position'>;
type CharacterNavigationOptions = Readonly<{
  actorId: string;
  target: NavigationPosition;
  perception: PerceptionSnapshot;
  resolveEntity: (entityId: string) => NavigationEntity | null;
}>;

type BodyObstacle = Readonly<{ position: NavigationPosition; localAabb: LocalAabb }>;

const translate = (position: NavigationPosition, local: LocalAabb): WorldAabb => ({
  min: {
    x: position[0] + local.min.x,
    y: position[1] + local.min.y,
    z: position[2] + local.min.z,
  },
  max: {
    x: position[0] + local.max.x,
    y: position[1] + local.max.y,
    z: position[2] + local.max.z,
  },
});

const sweptBounds = (from: WorldAabb, to: WorldAabb): WorldAabb => ({
  min: {
    x: Math.min(from.min.x, to.min.x),
    y: Math.min(from.min.y, to.min.y),
    z: Math.min(from.min.z, to.min.z),
  },
  max: {
    x: Math.max(from.max.x, to.max.x),
    y: Math.max(from.max.y, to.max.y),
    z: Math.max(from.max.z, to.max.z),
  },
});

type Axis = 'x' | 'y' | 'z';
const AXES: readonly Axis[] = ['x', 'y', 'z'];

const penetrationDepth = (left: WorldAabb, right: WorldAabb, axis: Axis): number =>
  Math.max(0, Math.min(left.max[axis], right.max[axis]) - Math.max(left.min[axis], right.min[axis]));

const overlaps = (left: WorldAabb, right: WorldAabb): boolean =>
  AXES.every((axis) => penetrationDepth(left, right, axis) > CONTACT_EPSILON);

const maximumPenetrationAlongAxis = (from: WorldAabb, to: WorldAabb, obstacle: WorldAabb, axis: Axis): number => {
  const delta = to.min[axis] - from.min[axis];
  const times = [0, 1];
  if (Math.abs(delta) > CONTACT_EPSILON)
    for (const moverEdge of [from.min[axis], from.max[axis]])
      for (const obstacleEdge of [obstacle.min[axis], obstacle.max[axis]]) {
        const time = (obstacleEdge - moverEdge) / delta;
        if (time > 0 && time < 1) times.push(time);
      }
  return Math.max(
    ...times.map((time) => {
      const min = from.min[axis] + delta * time;
      const max = from.max[axis] + delta * time;
      return Math.max(0, Math.min(max, obstacle.max[axis]) - Math.max(min, obstacle.min[axis]));
    }),
  );
};

const containsTarget = (obstacle: BodyObstacle, target: NavigationPosition): boolean => {
  const bounds = translate(obstacle.position, obstacle.localAabb);
  return (
    target[0] >= bounds.min.x &&
    target[0] <= bounds.max.x &&
    target[1] >= bounds.min.y &&
    target[1] <= bounds.max.y &&
    target[2] >= bounds.min.z &&
    target[2] <= bounds.max.z
  );
};

const bodyObstacle = (entity: NavigationEntity): BodyObstacle | null => {
  try {
    const config = bodyConfigFor(bodyKindForEntity(entity));
    if (
      ((config.collisionLayer ?? CollisionLayer.World) & CollisionLayer.Character) === 0 ||
      ((config.collisionMask ?? CollisionLayer.World) & CollisionLayer.Character) === 0
    )
      return null;
    return { position: [...entity.position], localAabb: config.localAabb };
  } catch {
    return null;
  }
};

const createBodyConstraint = (moverLocalAabb: LocalAabb, obstacles: readonly BodyObstacle[]): NavigationConstraint => {
  const obstacleBounds = obstacles.map((obstacle) => translate(obstacle.position, obstacle.localAabb));
  const allowsEscape = (from: NavigationPosition, to: NavigationPosition): boolean => {
    const fromBounds = translate(from, moverLocalAabb);
    const toBounds = translate(to, moverLocalAabb);
    const swept = sweptBounds(fromBounds, toBounds);
    const initiallyOverlapping = obstacleBounds.map((obstacle) => overlaps(fromBounds, obstacle));
    if (!initiallyOverlapping.some(Boolean)) return false;
    let reduced = false;
    for (const [index, obstacle] of obstacleBounds.entries()) {
      if (!initiallyOverlapping[index]) {
        if (overlaps(swept, obstacle)) return false;
        continue;
      }
      for (const axis of AXES) {
        const fromDepth = penetrationDepth(fromBounds, obstacle, axis);
        const toDepth = penetrationDepth(toBounds, obstacle, axis);
        if (maximumPenetrationAlongAxis(fromBounds, toBounds, obstacle, axis) > fromDepth + CONTACT_EPSILON)
          return false;
        if (toDepth + CONTACT_EPSILON < fromDepth) reduced = true;
      }
    }
    return reduced;
  };
  return {
    blocksNode: (position) => {
      const mover = translate(position, moverLocalAabb);
      return obstacleBounds.some((obstacle) => overlaps(mover, obstacle));
    },
    blocksEdge: (from, to) => {
      const fromBounds = translate(from, moverLocalAabb);
      const toBounds = translate(to, moverLocalAabb);
      if (allowsEscape(from, to)) return false;
      const swept = sweptBounds(fromBounds, toBounds);
      return obstacleBounds.some((obstacle) => overlaps(swept, obstacle));
    },
    allowsBlockedNodeTransition: allowsEscape,
  };
};

export const createCharacterNavigationConstraint = (options: CharacterNavigationOptions): NavigationConstraint => {
  if (options.perception.observerId !== options.actorId)
    throw new TypeError('Character navigation perception belongs to another actor.');
  const actor = options.resolveEntity(options.actorId);
  if (!actor) throw new RangeError(`Unknown navigation actor: ${options.actorId}`);
  const actorConfig = bodyConfigFor(bodyKindForEntity(actor));
  const visibleIds = [
    ...new Set(options.perception.visibleEntities.slice(0, MAX_LOCAL_BODY_OBSTACLES).map(({ entityId }) => entityId)),
  ]
    .sort((left, right) => left.localeCompare(right))
    .slice(0, MAX_LOCAL_BODY_OBSTACLES);
  const obstacles = visibleIds
    .filter((entityId) => entityId !== options.actorId)
    .map((entityId) => options.resolveEntity(entityId))
    .filter((entity): entity is NavigationEntity => entity !== null)
    .map(bodyObstacle)
    .filter((obstacle): obstacle is BodyObstacle => obstacle !== null)
    .filter((obstacle) => !containsTarget(obstacle, options.target));
  return createBodyConstraint(actorConfig.localAabb, obstacles);
};

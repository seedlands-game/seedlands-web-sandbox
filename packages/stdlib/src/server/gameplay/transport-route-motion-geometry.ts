import {
  bodyWorldAabb,
  sweepBodyThroughWorld,
  sweepOrientedBox,
  orientedBoxBounds,
  type Vec3,
  type Collider,
} from '../../physics';
import { colliderMatches, overlapDepth, translateAabb, unionAabb } from '../../physics/geometry';
import { advanceRouteSegmentV1, resolveRouteSegmentV1, validateRouteSegmentV1 } from './modules/route-definition';
import {
  buildRouteTransportMotionCandidateV1,
  type TransportMotionCandidateV1,
  type RouteNextSegmentV1,
} from './modules/transport-motion-model';
import { loadedRouteConnections, projectLoadedRouteNeighbors } from './transport-route-neighbors';
import {
  compoundBody,
  compoundBoxes,
  compoundMotionPathBody,
  type projectSurfaceMotion,
} from './transport-motion-geometry';

type Options = Parameters<typeof projectSurfaceMotion>[0];
type Cell = readonly [number, number, number];
const vector = (p: Cell) => ({ x: p[0], y: p[1], z: p[2] });
const zero = { x: 0, y: 0, z: 0 };

export function projectRouteMotion(options: Options): TransportMotionCandidateV1 {
  const { state, definition, policy, frame, config, entities, callbacks } = options;
  const route = config.routes.find((entry) => entry.definition.family === definition.locomotion.providerId);
  const cursor = state.routeCursor;
  if (!route || !cursor) throw new TypeError('Route motion requires its configured route and canonical cursor.');
  const variant = route.definition.variants.find((entry) => entry.variant === cursor.variant);
  const edge = variant?.edges.find(
    (entry) => JSON.stringify([entry.entry, entry.exit]) === JSON.stringify([cursor.entry, cursor.exit]),
  );
  if (!edge) throw new TypeError('Route cursor does not identify a configured directed edge.');
  let segment = validateRouteSegmentV1({
    family: route.definition.family,
    variant: cursor.variant,
    edge,
    length: cursor.segmentLength,
  });
  let previousSegment: typeof segment | null = null;
  const read = (cell: Cell) => {
    frame.world.querySolids({ min: vector(cell), max: { x: cell[0] + 1, y: cell[1] + 1, z: cell[2] + 1 } });
    return callbacks.getLoadedVoxel?.([...cell]);
  };
  const stopped = (reason: 'route-unknown' | 'route-disconnected'): TransportMotionCandidateV1 =>
    Object.freeze({
      version: 1,
      expected: {
        reference: state.reference,
        pose: state.pose,
        velocity: state.velocity,
        routeCursor: cursor,
        fuel: state.fuel,
      },
      next: { pose: state.pose, velocity: [0, 0, 0] as const, routeCursor: cursor },
      traveledDistance: 0,
      fuelCost: 0,
      stopReason: reason,
    });
  const currentVoxel = read(cursor.cell);
  if (currentVoxel === undefined) return stopped('route-unknown');
  if (!route.voxels.includes(currentVoxel)) return stopped('route-disconnected');
  const driven =
    state.rider &&
    frame.playerReference &&
    state.rider.entityId === frame.playerReference.entityId &&
    state.rider.lifetime === frame.playerReference.lifetime &&
    state.rider.epoch === frame.playerReference.epoch &&
    entities.resolveReference(frame.playerReference);
  const wish = driven ? frame.playerWish : zero;
  const forward = wish.x * Math.sin(state.pose.yaw) + wish.z * Math.cos(state.pose.yaw);
  const throttle =
    policy.throttleSource === 'fuel'
      ? state.fuel !== null && state.fuel > 0
        ? 1
        : 0
      : Math.abs(forward) <= 1e-9
        ? 0
        : forward > 0
          ? 1
          : -1;
  const updates = new Map(frame.updates.map((entry) => [entry.id, entry.update]));
  const others = entities
    .query()
    .filter((entity) => entity.id !== state.reference.entityId && entity.id !== state.rider?.entityId)
    .flatMap((entity) => {
      const body = frame.bodyConfigs.get(entity.id);
      if (!body) return [];
      const other = entity.type === 'transport' ? entities.transportState(entities.createReference(entity.id)!) : null;
      // A path of length L stays within L of its endpoint chord, including paths
      // spanning multiple curves. These are this frame's first-pass candidates only.
      const pathPadding = options.motionPaths?.get(entity.id)?.traveledDistance ?? 0;
      const compound = other
        ? compoundMotionPathBody(config.definitions.require(other.definitionId), other, frame, pathPadding)
        : body;
      return [{ entity, body: compound, next: updates.get(entity.id)?.position ?? entity.position }];
    });
  return buildRouteTransportMotionCandidateV1(route.definition, definition, state, {
    ...policy,
    throttle,
    seconds: frame.seconds,
    segment,
    resolveNext({ cell, exit }): RouteNextSegmentV1 {
      const probes = loadedRouteConnections(route, cell, exit, read);
      if (probes.some((probe) => probe.state === 'unknown')) return { status: 'unknown' };
      const connected = probes.filter((probe) => probe.state === 'connected');
      if (!connected.length) return { status: 'disconnected' };
      if (connected.length > 1) return { status: 'ambiguous' };
      const next = connected[0]!;
      const neighborhood = projectLoadedRouteNeighbors(route, next.cell, read);
      const resolution = resolveRouteSegmentV1(route.definition, {
        entry: next.entry,
        neighbors: neighborhood.neighbors,
      });
      if (resolution.status !== 'segment') return { status: resolution.status };
      if (neighborhood.ambiguous) return { status: 'ambiguous' };
      previousSegment = segment;
      segment = resolution.segment;
      return { status: 'segment', cell: next.cell, segment };
    },
    sweep(from, to) {
      const turning = segment.edge.curve === 'quarter';
      const tangent = advanceRouteSegmentV1(segment, 0, 0).tangent;
      // A radius-0.5 quarter arc is at most 0.5*(1-cos(pi/4)) from its chord.
      // The full yaw envelope includes the carrier and mounted rider at every arc pose.
      const routeState = {
        ...state,
        pose: { position: from, yaw: Math.atan2(tangent[0], tangent[2]) },
        routeCursor: { ...cursor, entry: segment.edge.entry, exit: segment.edge.exit },
      };
      const body = compoundBody(definition, routeState, frame, turning, turning ? 0.5 * (1 - Math.SQRT1_2) : 0);
      // The rider remains upright, so a changed seat offset has a translational path
      // even though the carrier orientation is selected discretely by its cursor.
      if (previousSegment && state.rider) {
        const oldTangent = advanceRouteSegmentV1(previousSegment, previousSegment.length, 0).tangent;
        const oldState = {
          ...routeState,
          pose: { position: from, yaw: Math.atan2(oldTangent[0], oldTangent[2]) },
          routeCursor: { ...cursor, entry: previousSegment.edge.entry, exit: previousSegment.edge.exit },
        };
        const oldRider = compoundBoxes(definition, oldState, frame)[1]!;
        const nextRider = compoundBoxes(definition, routeState, frame)[1]!;
        const movement = {
          x: nextRider.center.x - oldRider.center.x,
          y: nextRider.center.y - oldRider.center.y,
          z: nextRider.center.z - oldRider.center.z,
        };
        previousSegment = null;
        const oldBounds = orientedBoxBounds(oldRider);
        const seatPath = unionAabb(oldBounds, translateAabb(oldBounds, movement));
        const cells = (['x', 'y', 'z'] as const).reduce(
          (n, axis) => n * (Math.floor(seatPath.max[axis] - 1e-8) - Math.floor(seatPath.min[axis] + 1e-8) + 1),
          1,
        );
        if (!Number.isSafeInteger(cells) || cells <= 0 || cells > 4096) return 'unknown';
        const hits = frame.world
          .querySolids(seatPath)
          .filter(
            (collider) =>
              !collider.sensor &&
              colliderMatches(body, collider) &&
              sweepOrientedBox(oldRider, collider.aabb, movement) !== null,
          );
        if (hits.length) return hits.some((hit) => hit.id?.startsWith('unknown:')) ? 'unknown' : 'world-collision';
        for (const { entity, body: otherBody, next } of others) {
          const collider = {
            aabb: bodyWorldAabb({ position: vector(entity.position), velocity: zero }, otherBody),
            layer: otherBody.collisionLayer,
            mask: otherBody.collisionMask,
          };
          const relative = {
            x: movement.x - (next[0] - entity.position[0]),
            y: movement.y - (next[1] - entity.position[1]),
            z: movement.z - (next[2] - entity.position[2]),
          };
          if (colliderMatches(body, collider) && sweepOrientedBox(oldRider, collider.aabb, relative) !== null)
            return 'entity-collision';
        }
      }
      const start = { position: vector(from), velocity: zero };
      const delta = { x: to[0] - from[0], y: to[1] - from[1], z: to[2] - from[2] };
      const bounds = bodyWorldAabb(start, body);
      const boxes = !turning && segment.edge.slopeDelta !== 0 ? compoundBoxes(definition, routeState, frame) : null;
      const collides = (collider: Collider, movement: Vec3) =>
        boxes
          ? boxes.some((box) => sweepOrientedBox(box, collider.aabb, movement) !== null)
          : Boolean(
              overlapDepth(bounds, collider.aabb) ||
              sweepBodyThroughWorld(start, body, { querySolids: () => [collider] }, movement).contacts.length,
            );
      const swept = unionAabb(bounds, translateAabb(bounds, delta));
      const count = (['x', 'y', 'z'] as const).reduce(
        (n, axis) => n * (Math.floor(swept.max[axis] - 1e-8) - Math.floor(swept.min[axis] + 1e-8) + 1),
        1,
      );
      if (!Number.isSafeInteger(count) || count <= 0 || count > 4096) return 'unknown';
      const blockers = frame.world.querySolids(swept);
      if (boxes) {
        const collisions = blockers.filter(
          (collider) => !collider.sensor && colliderMatches(body, collider) && collides(collider, delta),
        );
        if (collisions.length)
          return collisions.some((collider) => collider.id?.startsWith('unknown:')) ? 'unknown' : 'world-collision';
      } else {
        if (
          blockers.some(
            (collider) => !collider.sensor && colliderMatches(body, collider) && overlapDepth(bounds, collider.aabb),
          )
        )
          return blockers.some((collider) => collider.id?.startsWith('unknown:')) ? 'unknown' : 'world-collision';
        const collision = sweepBodyThroughWorld(start, body, { querySolids: () => blockers }, delta);
        if (collision.contacts.length)
          return collision.contacts.some(({ collider }) => collider.id?.startsWith('unknown:'))
            ? 'unknown'
            : 'world-collision';
      }
      for (const { entity, body: otherBody, next } of others) {
        const collider = {
          id: entity.id,
          aabb: bodyWorldAabb({ position: vector(entity.position), velocity: zero }, otherBody),
          layer: otherBody.collisionLayer,
          mask: otherBody.collisionMask,
        };
        if (!colliderMatches(body, collider)) continue;
        const relative = {
          x: delta.x - (next[0] - entity.position[0]),
          y: delta.y - (next[1] - entity.position[1]),
          z: delta.z - (next[2] - entity.position[2]),
        };
        if (collides(collider, relative)) return 'entity-collision';
      }
      return 'clear';
    },
  });
}

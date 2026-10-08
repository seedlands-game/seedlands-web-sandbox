import {
  advanceRouteSegmentV1,
  defineRouteDefinitionV1,
  validateRouteSegmentV1,
  type RouteDefinitionV1,
  type RouteEndpointV1,
  type RouteSegmentV1,
} from './route-definition';
import type { TransportDefinitionV1, TransportRouteCursorV2, TransportStateV2 } from './transport-model';

const EPSILON = 1e-9;
const MAX_ROUTE_TRANSITIONS = 64;

export type TransportCollisionV1 = 'clear' | 'world-collision' | 'entity-collision' | 'unknown';
export type TransportMotionStopReasonV1 =
  | 'route-unknown'
  | 'route-disconnected'
  | 'route-ambiguous'
  | 'transition-limit'
  | 'surface-unknown'
  | 'left-surface'
  | 'world-collision'
  | 'entity-collision'
  | 'frontier-unknown'
  | 'fuel-empty';

export type TransportMotionExpectedV1 = Readonly<{
  reference: TransportStateV2['reference'];
  pose: TransportStateV2['pose'];
  velocity: TransportStateV2['velocity'];
  routeCursor: TransportRouteCursorV2 | null;
  fuel: number | null;
}>;

export type TransportMotionCandidateV1 = Readonly<{
  version: 1;
  expected: TransportMotionExpectedV1;
  next: Readonly<{
    pose: TransportStateV2['pose'];
    velocity: TransportStateV2['velocity'];
    routeCursor: TransportRouteCursorV2 | null;
  }>;
  traveledDistance: number;
  fuelCost: number;
  stopReason: TransportMotionStopReasonV1 | null;
}>;

export type RouteNextSegmentV1 =
  | Readonly<{ status: 'segment'; cell: readonly [number, number, number]; segment: RouteSegmentV1 }>
  | Readonly<{ status: 'unknown' | 'disconnected' | 'ambiguous' }>;

export type TransportSweepPortV1 = (
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  bodyAabb: TransportDefinitionV1['bodyAabb'],
) => TransportCollisionV1;

export type SurfaceSupportPortV1 = (
  position: readonly [number, number, number],
) => 'supported' | 'unsupported' | 'unknown';

export type MountedSeatConstraintV1 = Readonly<{
  rider: NonNullable<TransportStateV2['rider']>;
  walkingEnabled: false;
  pose: TransportStateV2['pose'];
}>;

export type TransportMotionPolicyV1 = Readonly<{
  seconds: number;
  throttle: -1 | 0 | 1;
  acceleration: number;
  drag: number;
  maxSpeed: number;
  fuelPerMeter: number;
}>;

export const tuple = (value: readonly number[], label: string): readonly [number, number, number] => {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite))
    throw new TypeError(`${label} is invalid.`);
  return Object.freeze([value[0]!, value[1]!, value[2]!] as const);
};

const cellTuple = (value: readonly number[], label: string): readonly [number, number, number] => {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isSafeInteger))
    throw new TypeError(`${label} is invalid.`);
  return Object.freeze([value[0]!, value[1]!, value[2]!] as const);
};

export const pose = (value: TransportStateV2['pose']): TransportStateV2['pose'] => {
  if (!value || !Number.isFinite(value.yaw)) throw new TypeError('Transport pose is invalid.');
  return Object.freeze({ position: tuple(value.position, 'Transport position'), yaw: value.yaw });
};

export const routeCursor = (value: TransportRouteCursorV2 | null): TransportRouteCursorV2 | null =>
  value ? cloneRouteCursor(value) : null;

const cloneRouteCursor = (value: TransportRouteCursorV2): TransportRouteCursorV2 => {
  if (
    !value ||
    typeof value.family !== 'string' ||
    !value.family.includes(':') ||
    typeof value.variant !== 'string' ||
    !value.variant.includes(':') ||
    !Number.isFinite(value.progress) ||
    !Number.isFinite(value.segmentLength) ||
    value.segmentLength <= 0 ||
    value.progress < 0 ||
    value.progress > value.segmentLength ||
    !value.entry ||
    !value.exit ||
    !['north', 'east', 'south', 'west'].includes(value.entry.side) ||
    !['north', 'east', 'south', 'west'].includes(value.exit.side) ||
    ![-1, 0, 1].includes(value.entry.elevation) ||
    ![-1, 0, 1].includes(value.exit.elevation)
  )
    throw new TypeError('Transport route cursor is invalid.');
  return Object.freeze({
    ...value,
    cell: cellTuple(value.cell, 'Transport route cell'),
    entry: Object.freeze({ ...value.entry }),
    exit: Object.freeze({ ...value.exit }),
  });
};

export const expected = (state: TransportStateV2): TransportMotionExpectedV1 =>
  Object.freeze({
    reference: Object.freeze({ ...state.reference }),
    pose: pose(state.pose),
    velocity: tuple(state.velocity, 'Transport velocity'),
    routeCursor: routeCursor(state.routeCursor),
    fuel: state.fuel,
  });

const validatePolicy = (policy: TransportMotionPolicyV1): void => {
  if (
    !policy ||
    !Number.isFinite(policy.seconds) ||
    policy.seconds <= 0 ||
    ![-1, 0, 1].includes(policy.throttle) ||
    !Number.isFinite(policy.acceleration) ||
    policy.acceleration < 0 ||
    !Number.isFinite(policy.drag) ||
    policy.drag < 0 ||
    !Number.isFinite(policy.maxSpeed) ||
    policy.maxSpeed <= 0 ||
    !Number.isFinite(policy.fuelPerMeter) ||
    policy.fuelPerMeter < 0
  )
    throw new TypeError('Transport motion policy is invalid.');
};

const speed = (velocity: readonly [number, number, number]): number => Math.hypot(...velocity);
const surfaceSpeed = (state: TransportStateV2): number =>
  state.velocity[0] * Math.sin(state.pose.yaw) + state.velocity[2] * Math.cos(state.pose.yaw);

const integrateSpeed = (
  initial: number,
  policy: TransportMotionPolicyV1,
  minimum = 0,
): Readonly<{ speed: number; distance: number }> => {
  const start = Math.max(minimum, Math.min(policy.maxSpeed, initial));
  const drive = policy.throttle * policy.acceleration;
  const integrate = (seconds: number) => {
    if (policy.drag <= EPSILON)
      return Object.freeze({ speed: start + drive * seconds, distance: start * seconds + (drive * seconds ** 2) / 2 });
    const decay = Math.exp(-policy.drag * seconds);
    const equilibrium = drive / policy.drag;
    return Object.freeze({
      speed: equilibrium + (start - equilibrium) * decay,
      distance: equilibrium * seconds + ((start - equilibrium) * (1 - decay)) / policy.drag,
    });
  };
  const boundaryTime = (boundary: 0 | number): number | null => {
    if (policy.drag <= EPSILON) {
      if (Math.abs(drive) <= EPSILON) return null;
      const seconds = (boundary - start) / drive;
      return seconds > EPSILON && seconds < policy.seconds ? seconds : null;
    }
    const equilibrium = drive / policy.drag;
    const ratio = (boundary - equilibrium) / (start - equilibrium);
    if (!(ratio > 0) || !Number.isFinite(ratio)) return null;
    const seconds = -Math.log(ratio) / policy.drag;
    return seconds > EPSILON && seconds < policy.seconds ? seconds : null;
  };
  const boundary = drive > policy.drag * start ? policy.maxSpeed : drive < policy.drag * start ? minimum : null;
  const hit = boundary === null ? null : boundaryTime(boundary);
  let integrated = integrate(hit ?? policy.seconds);
  if (hit !== null) {
    integrated = Object.freeze({
      speed: boundary!,
      distance: integrated.distance + boundary! * (policy.seconds - hit),
    });
  }
  const next = Math.max(minimum, Math.min(policy.maxSpeed, integrated.speed));
  const distance = Math.max(minimum * policy.seconds, Math.min(policy.maxSpeed * policy.seconds, integrated.distance));
  if (![next, distance].every(Number.isFinite)) throw new Error('Transport speed integration is non-finite.');
  return Object.freeze({ speed: next, distance });
};

const fuelLimit = (
  state: TransportStateV2,
  requestedDistance: number,
  fuelPerMeter: number,
): Readonly<{ distance: number; cost: number; exhausted: boolean }> => {
  if (state.fuel === null || fuelPerMeter === 0)
    return Object.freeze({ distance: requestedDistance, cost: 0, exhausted: false });
  if (!Number.isFinite(state.fuel) || state.fuel < 0) throw new TypeError('Transport fuel is invalid.');
  const availableDistance = state.fuel / fuelPerMeter;
  const requestedMagnitude = Math.abs(requestedDistance);
  const distance = Math.min(requestedMagnitude, availableDistance);
  const cost = Math.min(state.fuel, distance * fuelPerMeter);
  return Object.freeze({
    distance: Math.sign(requestedDistance) * distance,
    cost,
    exhausted: requestedMagnitude > EPSILON && availableDistance <= requestedMagnitude + EPSILON,
  });
};

const stopForCollision = (collision: TransportCollisionV1): TransportMotionStopReasonV1 | null => {
  if (collision === 'clear') return null;
  if (collision === 'unknown') return 'frontier-unknown';
  if (collision === 'world-collision' || collision === 'entity-collision') return collision;
  throw new TypeError('Transport collision result is invalid.');
};

const sameEndpoint = (left: RouteEndpointV1, right: RouteEndpointV1): boolean =>
  left.side === right.side && left.elevation === right.elevation;

const routeSegment = (definition: RouteDefinitionV1, raw: RouteSegmentV1): RouteSegmentV1 => {
  const segment = validateRouteSegmentV1(raw);
  if (segment.family !== definition.family) throw new TypeError('Route segment family does not match its definition.');
  const variant = definition.variants.find((candidate) => candidate.variant === segment.variant);
  const edge = variant?.edges.find(
    (candidate) =>
      sameEndpoint(candidate.entry, segment.edge.entry) &&
      sameEndpoint(candidate.exit, segment.edge.exit) &&
      candidate.curve === segment.edge.curve &&
      candidate.slopeDelta === segment.edge.slopeDelta,
  );
  if (!edge) throw new TypeError('Route segment is not registered by its definition.');
  return Object.freeze({ family: definition.family, variant: variant!.variant, edge, length: segment.length });
};

const validateNext = (definition: RouteDefinitionV1, raw: RouteNextSegmentV1): RouteNextSegmentV1 => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('Route resolution result is invalid.');
  if (raw.status === 'segment') {
    if (Object.keys(raw).length !== 3) throw new TypeError('Route resolution result fields are invalid.');
    return Object.freeze({
      status: 'segment',
      cell: cellTuple(raw.cell, 'Next route cell'),
      segment: routeSegment(definition, raw.segment),
    });
  }
  if (raw.status === 'unknown' || raw.status === 'disconnected' || raw.status === 'ambiguous') {
    if (Object.keys(raw).length !== 1) throw new TypeError('Route resolution result fields are invalid.');
    return Object.freeze({ status: raw.status });
  }
  throw new TypeError('Route resolution result is invalid.');
};

const validateRouteSegment = (
  state: TransportStateV2,
  definition: TransportDefinitionV1,
  segment: RouteSegmentV1,
): TransportRouteCursorV2 => {
  const cursor = state.routeCursor;
  if (definition.locomotion.provider !== 'route' || !cursor)
    throw new TypeError('Route motion requires a route transport and cursor.');
  if (
    cursor.family !== definition.locomotion.providerId ||
    cursor.family !== segment.family ||
    cursor.variant !== segment.variant ||
    !sameEndpoint(cursor.entry, segment.edge.entry) ||
    !sameEndpoint(cursor.exit, segment.edge.exit) ||
    !Number.isFinite(cursor.progress) ||
    cursor.progress < 0 ||
    Math.abs(cursor.segmentLength - segment.length) > EPSILON ||
    cursor.progress > segment.length ||
    !Number.isFinite(segment.length) ||
    segment.length <= 0
  )
    throw new TypeError('Transport route cursor does not match its segment.');
  return cursor;
};

const worldRoutePosition = (
  cell: readonly [number, number, number],
  local: readonly [number, number, number],
): readonly [number, number, number] =>
  tuple([cell[0] + local[0], cell[1] + local[1], cell[2] + local[2]], 'Route world position');

const samePosition = (left: readonly number[], right: readonly number[]): boolean =>
  left.length === right.length && left.every((value, axis) => Math.abs(value - right[axis]!) <= EPSILON);

const yawForTangent = (tangent: readonly [number, number, number]): number => Math.atan2(tangent[0], tangent[2]);

const stoppedCandidate = (
  state: TransportStateV2,
  nextPose: TransportStateV2['pose'],
  cursor: TransportRouteCursorV2 | null,
  traveledDistance: number,
  fuelCost: number,
  reason: TransportMotionStopReasonV1,
): TransportMotionCandidateV1 =>
  Object.freeze({
    version: 1,
    expected: expected(state),
    next: Object.freeze({
      pose: pose(nextPose),
      velocity: tuple([0, 0, 0], 'Stopped velocity'),
      routeCursor: routeCursor(cursor),
    }),
    traveledDistance,
    fuelCost,
    stopReason: reason,
  });

export function buildRouteTransportMotionCandidateV1(
  rawRouteDefinition: RouteDefinitionV1,
  definition: TransportDefinitionV1,
  state: TransportStateV2,
  input: TransportMotionPolicyV1 &
    Readonly<{
      segment: RouteSegmentV1;
      resolveNext(
        input: Readonly<{ cell: readonly [number, number, number]; exit: RouteEndpointV1 }>,
      ): RouteNextSegmentV1;
      sweep: TransportSweepPortV1;
    }>,
): TransportMotionCandidateV1 {
  if (state.definitionId !== definition.id) throw new TypeError('Transport motion definition does not match state.');
  validatePolicy(input);
  const routeDefinition = defineRouteDefinitionV1(rawRouteDefinition);
  if (definition.locomotion.provider !== 'route' || definition.locomotion.providerId !== routeDefinition.family)
    throw new TypeError('Route definition does not match the transport provider.');
  const initialSegment = routeSegment(routeDefinition, input.segment);
  let cursor = validateRouteSegment(state, definition, initialSegment);
  let segment = initialSegment;
  let cell = cellTuple(cursor.cell, 'Transport route cell');
  let nextPose = pose(state.pose);
  const currentRoute = advanceRouteSegmentV1(segment, 0, cursor.progress);
  const currentLocal = currentRoute.position;
  let nextTangent = currentRoute.tangent;
  if (!samePosition(nextPose.position, worldRoutePosition(cell, currentLocal)))
    throw new TypeError('Transport pose does not match its route cursor.');
  const velocity = tuple(state.velocity, 'Transport velocity');
  const routeSpeed = speed(velocity);
  if (
    routeSpeed > EPSILON &&
    !samePosition(
      velocity.map((component) => component / routeSpeed),
      currentRoute.tangent,
    )
  )
    throw new TypeError('Transport velocity does not match its directed route segment.');
  const integration = integrateSpeed(routeSpeed, input);
  const fueled = fuelLimit(state, integration.distance, input.fuelPerMeter);
  let remaining = fueled.distance;
  let traveled = 0;
  let transitions = 0;

  while (remaining > EPSILON) {
    const advanced = advanceRouteSegmentV1(segment, cursor.progress, remaining);
    const targetPosition = worldRoutePosition(cell, advanced.position);
    const collision = stopForCollision(input.sweep(nextPose.position, targetPosition, definition.bodyAabb));
    if (collision) return stoppedCandidate(state, nextPose, cursor, traveled, traveled * input.fuelPerMeter, collision);
    const consumed = remaining - advanced.overshoot;
    traveled += consumed;
    remaining = advanced.overshoot;
    nextPose = Object.freeze({ position: targetPosition, yaw: yawForTangent(advanced.tangent) });
    nextTangent = advanced.tangent;
    cursor = Object.freeze({
      family: segment.family,
      cell,
      variant: segment.variant,
      entry: segment.edge.entry,
      exit: segment.edge.exit,
      progress: advanced.progress,
      segmentLength: segment.length,
    });
    if (remaining <= EPSILON) break;
    if (++transitions > MAX_ROUTE_TRANSITIONS)
      return stoppedCandidate(state, nextPose, cursor, traveled, traveled * input.fuelPerMeter, 'transition-limit');
    const next = validateNext(routeDefinition, input.resolveNext({ cell, exit: segment.edge.exit }));
    if (next.status !== 'segment')
      return stoppedCandidate(
        state,
        nextPose,
        cursor,
        traveled,
        traveled * input.fuelPerMeter,
        next.status === 'unknown'
          ? 'route-unknown'
          : next.status === 'ambiguous'
            ? 'route-ambiguous'
            : 'route-disconnected',
      );
    if (next.segment.family !== definition.locomotion.providerId)
      throw new TypeError('Next route segment family does not match the transport provider.');
    const nextCell = cellTuple(next.cell, 'Next route cell');
    const currentExit = worldRoutePosition(cell, advanceRouteSegmentV1(segment, 0, segment.length).position);
    const nextEntry = worldRoutePosition(nextCell, advanceRouteSegmentV1(next.segment, 0, 0).position);
    if (!samePosition(currentExit, nextEntry)) throw new TypeError('Next route segment is not spatially continuous.');
    segment = next.segment;
    cell = nextCell;
    cursor = Object.freeze({
      family: segment.family,
      cell,
      variant: segment.variant,
      entry: segment.edge.entry,
      exit: segment.edge.exit,
      progress: 0,
      segmentLength: segment.length,
    });
  }

  const stopReason = fueled.exhausted ? 'fuel-empty' : null;
  return Object.freeze({
    version: 1,
    expected: expected(state),
    next: Object.freeze({
      pose: nextPose,
      velocity: tuple(
        stopReason ? [0, 0, 0] : nextTangent.map((component) => component * integration.speed),
        'Route candidate velocity',
      ),
      routeCursor: cursor,
    }),
    traveledDistance: traveled,
    fuelCost: fueled.cost,
    stopReason,
  });
}

const integrateSurfacePosition = (
  position: readonly [number, number, number],
  yaw: number,
  distance: number,
  yawDelta: number,
): Readonly<{ position: readonly [number, number, number]; yaw: number }> => {
  const nextYaw = yaw + yawDelta;
  if (Math.abs(yawDelta) <= EPSILON)
    return Object.freeze({
      position: tuple(
        [position[0] + Math.sin(yaw) * distance, position[1], position[2] + Math.cos(yaw) * distance],
        'Surface transport position',
      ),
      yaw: nextYaw,
    });
  const radius = distance / yawDelta;
  return Object.freeze({
    position: tuple(
      [
        position[0] + radius * (Math.cos(yaw) - Math.cos(nextYaw)),
        position[1],
        position[2] + radius * (Math.sin(nextYaw) - Math.sin(yaw)),
      ],
      'Surface transport arc position',
    ),
    yaw: nextYaw,
  });
};

export function buildSurfaceTransportMotionCandidateV1(
  definition: TransportDefinitionV1,
  state: TransportStateV2,
  input: TransportMotionPolicyV1 &
    Readonly<{
      steering: number;
      steeringRate: number;
      sampleSurface: SurfaceSupportPortV1;
      sweep: TransportSweepPortV1;
    }>,
): TransportMotionCandidateV1 {
  if (
    state.definitionId !== definition.id ||
    definition.locomotion.provider !== 'surface' ||
    state.routeCursor !== null
  )
    throw new TypeError('Surface motion requires a matching surface transport.');
  validatePolicy(input);
  if (
    !Number.isFinite(input.steering) ||
    input.steering < -1 ||
    input.steering > 1 ||
    !Number.isFinite(input.steeringRate) ||
    input.steeringRate < 0
  )
    throw new TypeError('Surface steering policy is invalid.');
  const currentPose = pose(state.pose);
  const integration = integrateSpeed(surfaceSpeed(state), input, -input.maxSpeed);
  const fueled = fuelLimit(state, integration.distance, input.fuelPerMeter);
  const fraction = Math.abs(integration.distance) <= EPSILON ? 0 : fueled.distance / integration.distance;
  const advanced = integrateSurfacePosition(
    currentPose.position,
    currentPose.yaw,
    fueled.distance,
    input.steering * input.steeringRate * input.seconds * fraction * Math.sign(fueled.distance),
  );
  const support = input.sampleSurface(advanced.position);
  if (support !== 'supported' && support !== 'unsupported' && support !== 'unknown')
    throw new TypeError('Surface support result is invalid.');
  if (support === 'unknown') return stoppedCandidate(state, currentPose, null, 0, 0, 'surface-unknown');
  if (support === 'unsupported') return stoppedCandidate(state, currentPose, null, 0, 0, 'left-surface');
  const collision = stopForCollision(input.sweep(currentPose.position, advanced.position, definition.bodyAabb));
  if (collision) return stoppedCandidate(state, currentPose, null, 0, 0, collision);
  const stopReason = fueled.exhausted ? 'fuel-empty' : null;
  return Object.freeze({
    version: 1,
    expected: expected(state),
    next: Object.freeze({
      pose: pose({ position: advanced.position, yaw: advanced.yaw }),
      velocity: tuple(
        stopReason
          ? [0, 0, 0]
          : [Math.sin(advanced.yaw) * integration.speed, state.velocity[1], Math.cos(advanced.yaw) * integration.speed],
        'Surface candidate velocity',
      ),
      routeCursor: null,
    }),
    traveledDistance: Math.abs(fueled.distance),
    fuelCost: fueled.cost,
    stopReason,
  });
}

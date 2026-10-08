import type { RouteEndpointV1 } from './route-definition';
import type { TransportRouteCursorV2, TransportStateV2 } from './transport-model';

export const TRANSPORT_MOTION_EPSILON = 1e-9;

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

export type TransportMotionPolicyV1 = Readonly<{
  seconds: number;
  throttle: -1 | 0 | 1;
  acceleration: number;
  drag: number;
  maxSpeed: number;
  fuelPerMeter: number;
}>;

const ROUTE_SIDES = ['north', 'east', 'south', 'west'] as const;
const STOP_REASONS: readonly TransportMotionStopReasonV1[] = [
  'route-unknown',
  'route-disconnected',
  'route-ambiguous',
  'transition-limit',
  'surface-unknown',
  'left-surface',
  'world-collision',
  'entity-collision',
  'frontier-unknown',
  'fuel-empty',
];

const exact = (raw: unknown, keys: readonly string[], label: string): Record<string, unknown> => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError(label + ' is invalid.');
  const value = raw as Record<string, unknown>;
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key)))
    throw new TypeError(label + ' fields are invalid.');
  return value;
};

export const cloneMotionTuple = (value: readonly number[], label: string): readonly [number, number, number] => {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite))
    throw new TypeError(label + ' is invalid.');
  return Object.freeze([value[0]!, value[1]!, value[2]!] as const);
};

export const cloneMotionCell = (value: readonly number[], label: string): readonly [number, number, number] => {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isSafeInteger))
    throw new TypeError(label + ' is invalid.');
  return Object.freeze([value[0]!, value[1]!, value[2]!] as const);
};

export const cloneMotionPose = (value: TransportStateV2['pose']): TransportStateV2['pose'] => {
  const pose = exact(value, ['position', 'yaw'], 'Transport pose');
  if (!Number.isFinite(pose.yaw)) throw new TypeError('Transport pose is invalid.');
  return Object.freeze({
    position: cloneMotionTuple(pose.position as readonly number[], 'Transport position'),
    yaw: pose.yaw as number,
  });
};

const cloneEndpoint = (raw: unknown, label: string): RouteEndpointV1 => {
  const value = exact(raw, ['side', 'elevation'], label);
  if (!ROUTE_SIDES.includes(value.side as RouteEndpointV1['side']) || ![-1, 0, 1].includes(value.elevation as number))
    throw new TypeError(label + ' is invalid.');
  return Object.freeze({
    side: value.side as RouteEndpointV1['side'],
    elevation: value.elevation as RouteEndpointV1['elevation'],
  });
};

export const cloneMotionRouteCursor = (value: TransportRouteCursorV2 | null): TransportRouteCursorV2 | null => {
  if (value === null) return null;
  const cursor = exact(
    value,
    ['family', 'cell', 'variant', 'entry', 'exit', 'progress', 'segmentLength'],
    'Transport route cursor',
  );
  if (
    typeof cursor.family !== 'string' ||
    !cursor.family.includes(':') ||
    typeof cursor.variant !== 'string' ||
    !cursor.variant.includes(':') ||
    !Number.isFinite(cursor.progress) ||
    !Number.isFinite(cursor.segmentLength) ||
    (cursor.segmentLength as number) <= 0 ||
    (cursor.progress as number) < 0 ||
    (cursor.progress as number) > (cursor.segmentLength as number)
  )
    throw new TypeError('Transport route cursor is invalid.');
  return Object.freeze({
    family: cursor.family,
    cell: cloneMotionCell(cursor.cell as readonly number[], 'Transport route cell'),
    variant: cursor.variant,
    entry: cloneEndpoint(cursor.entry, 'Transport route entry'),
    exit: cloneEndpoint(cursor.exit, 'Transport route exit'),
    progress: cursor.progress as number,
    segmentLength: cursor.segmentLength as number,
  });
};

const cloneReference = (raw: unknown): TransportStateV2['reference'] => {
  const reference = exact(raw, ['entityId', 'epoch', 'lifetime'], 'Transport reference');
  if (
    typeof reference.entityId !== 'string' ||
    !reference.entityId.trim() ||
    !Number.isSafeInteger(reference.epoch) ||
    (reference.epoch as number) <= 0 ||
    !Number.isSafeInteger(reference.lifetime) ||
    (reference.lifetime as number) <= 0
  )
    throw new TypeError('Transport reference is invalid.');
  return Object.freeze({
    entityId: reference.entityId,
    epoch: reference.epoch as number,
    lifetime: reference.lifetime as number,
  });
};

const cloneFuel = (value: unknown): number | null => {
  if (value === null) return null;
  if (!Number.isFinite(value) || (value as number) < 0) throw new TypeError('Transport fuel is invalid.');
  return value as number;
};

export const snapshotMotionExpected = (state: TransportStateV2): TransportMotionExpectedV1 =>
  Object.freeze({
    reference: cloneReference(state.reference),
    pose: cloneMotionPose(state.pose),
    velocity: cloneMotionTuple(state.velocity, 'Transport velocity'),
    routeCursor: cloneMotionRouteCursor(state.routeCursor),
    fuel: cloneFuel(state.fuel),
  });

export const validateTransportMotionPolicy = (policy: TransportMotionPolicyV1): void => {
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

export const transportSpeed = (velocity: readonly [number, number, number]): number => Math.hypot(...velocity);

export const surfaceSignedSpeed = (state: TransportStateV2): number =>
  state.velocity[0] * Math.sin(state.pose.yaw) + state.velocity[2] * Math.cos(state.pose.yaw);

export const integrateTransportSpeed = (
  initial: number,
  policy: TransportMotionPolicyV1,
  minimum = 0,
): Readonly<{ speed: number; distance: number }> => {
  const start = Math.max(minimum, Math.min(policy.maxSpeed, initial));
  const drive = policy.throttle * policy.acceleration;
  const integrate = (seconds: number) => {
    if (policy.drag <= TRANSPORT_MOTION_EPSILON)
      return Object.freeze({ speed: start + drive * seconds, distance: start * seconds + (drive * seconds ** 2) / 2 });
    const decay = Math.exp(-policy.drag * seconds);
    const equilibrium = drive / policy.drag;
    return Object.freeze({
      speed: equilibrium + (start - equilibrium) * decay,
      distance: equilibrium * seconds + ((start - equilibrium) * (1 - decay)) / policy.drag,
    });
  };
  const boundaryTime = (boundary: number): number | null => {
    if (policy.drag <= TRANSPORT_MOTION_EPSILON) {
      if (Math.abs(drive) <= TRANSPORT_MOTION_EPSILON) return null;
      const seconds = (boundary - start) / drive;
      return seconds > TRANSPORT_MOTION_EPSILON && seconds < policy.seconds ? seconds : null;
    }
    const equilibrium = drive / policy.drag;
    const ratio = (boundary - equilibrium) / (start - equilibrium);
    if (!(ratio > 0) || !Number.isFinite(ratio)) return null;
    const seconds = -Math.log(ratio) / policy.drag;
    return seconds > TRANSPORT_MOTION_EPSILON && seconds < policy.seconds ? seconds : null;
  };
  const boundary = drive > policy.drag * start ? policy.maxSpeed : drive < policy.drag * start ? minimum : null;
  const hit = boundary === null ? null : boundaryTime(boundary);
  let integrated = integrate(hit ?? policy.seconds);
  if (hit !== null)
    integrated = Object.freeze({
      speed: boundary!,
      distance: integrated.distance + boundary! * (policy.seconds - hit),
    });
  const next = Math.max(minimum, Math.min(policy.maxSpeed, integrated.speed));
  const distance = Math.max(minimum * policy.seconds, Math.min(policy.maxSpeed * policy.seconds, integrated.distance));
  if (![next, distance].every(Number.isFinite)) throw new Error('Transport speed integration is non-finite.');
  return Object.freeze({ speed: next, distance });
};

export const limitTransportDistanceByFuel = (
  state: TransportStateV2,
  requestedDistance: number,
  fuelPerMeter: number,
): Readonly<{ distance: number; cost: number; exhausted: boolean }> => {
  const fuel = cloneFuel(state.fuel);
  if (fuel === null || fuelPerMeter === 0)
    return Object.freeze({ distance: requestedDistance, cost: 0, exhausted: false });
  const availableDistance = fuel / fuelPerMeter;
  const requestedMagnitude = Math.abs(requestedDistance);
  const distance = Math.min(requestedMagnitude, availableDistance);
  return Object.freeze({
    distance: Math.sign(requestedDistance) * distance,
    cost: Math.min(fuel, distance * fuelPerMeter),
    exhausted:
      requestedMagnitude > TRANSPORT_MOTION_EPSILON &&
      availableDistance <= requestedMagnitude + TRANSPORT_MOTION_EPSILON,
  });
};

export const collisionStopReason = (collision: TransportCollisionV1): TransportMotionStopReasonV1 | null => {
  if (collision === 'clear') return null;
  if (collision === 'unknown') return 'frontier-unknown';
  if (collision === 'world-collision' || collision === 'entity-collision') return collision;
  throw new TypeError('Transport collision result is invalid.');
};

export const validateSurfaceSupport = (value: ReturnType<import('./transport-motion-model').SurfaceSupportPortV1>) => {
  if (value !== 'supported' && value !== 'unsupported' && value !== 'unknown')
    throw new TypeError('Surface support result is invalid.');
  return value;
};

export function validateTransportMotionCandidateV1(raw: unknown): TransportMotionCandidateV1 {
  const value = exact(
    raw,
    ['version', 'expected', 'next', 'traveledDistance', 'fuelCost', 'stopReason'],
    'Transport motion candidate',
  );
  if (value.version !== 1) throw new TypeError('Transport motion candidate version is invalid.');
  const expectedValue = exact(
    value.expected,
    ['reference', 'pose', 'velocity', 'routeCursor', 'fuel'],
    'Transport expected state',
  );
  const next = exact(value.next, ['pose', 'velocity', 'routeCursor'], 'Transport next state');
  if (
    !Number.isFinite(value.traveledDistance) ||
    (value.traveledDistance as number) < 0 ||
    !Number.isFinite(value.fuelCost) ||
    (value.fuelCost as number) < 0 ||
    (value.stopReason !== null && !STOP_REASONS.includes(value.stopReason as TransportMotionStopReasonV1))
  )
    throw new TypeError('Transport motion candidate result is invalid.');
  const candidate = Object.freeze({
    version: 1 as const,
    expected: Object.freeze({
      reference: cloneReference(expectedValue.reference),
      pose: cloneMotionPose(expectedValue.pose as TransportStateV2['pose']),
      velocity: cloneMotionTuple(expectedValue.velocity as readonly number[], 'Transport expected velocity'),
      routeCursor: cloneMotionRouteCursor(expectedValue.routeCursor as TransportRouteCursorV2 | null),
      fuel: cloneFuel(expectedValue.fuel),
    }),
    next: Object.freeze({
      pose: cloneMotionPose(next.pose as TransportStateV2['pose']),
      velocity: cloneMotionTuple(next.velocity as readonly number[], 'Transport candidate velocity'),
      routeCursor: cloneMotionRouteCursor(next.routeCursor as TransportRouteCursorV2 | null),
    }),
    traveledDistance: value.traveledDistance as number,
    fuelCost: value.fuelCost as number,
    stopReason: value.stopReason as TransportMotionStopReasonV1 | null,
  });
  if (candidate.expected.fuel !== null && candidate.fuelCost > candidate.expected.fuel + TRANSPORT_MOTION_EPSILON)
    throw new TypeError('Transport motion candidate exceeds available fuel.');
  if (
    candidate.stopReason &&
    candidate.next.velocity.some((component) => Math.abs(component) > TRANSPORT_MOTION_EPSILON)
  )
    throw new TypeError('Stopped transport motion candidate must have zero velocity.');
  return candidate;
}

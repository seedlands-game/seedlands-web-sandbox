import type { TransportDefinitionV1, TransportStateV2 } from './transport-model';
import {
  expected,
  pose,
  routeCursor,
  tuple,
  type MountedSeatConstraintV1,
  type TransportMotionCandidateV1,
} from './transport-motion-model';

const EPSILON = 1e-9;

export function commitTransportMotionCandidateV1(
  state: TransportStateV2,
  candidate: TransportMotionCandidateV1,
): TransportStateV2 {
  if (candidate.version !== 1 || JSON.stringify(expected(state)) !== JSON.stringify(candidate.expected))
    throw new Error('Transport motion candidate is stale.');
  if (
    !Number.isFinite(candidate.traveledDistance) ||
    candidate.traveledDistance < 0 ||
    !Number.isFinite(candidate.fuelCost) ||
    candidate.fuelCost < 0
  )
    throw new TypeError('Transport motion candidate cost is invalid.');
  const fuel = state.fuel === null ? null : state.fuel - candidate.fuelCost;
  if (fuel !== null && fuel < -EPSILON) throw new TypeError('Transport motion candidate exceeds available fuel.');
  return Object.freeze({
    ...state,
    pose: pose(candidate.next.pose),
    velocity: tuple(candidate.next.velocity, 'Transport candidate velocity'),
    routeCursor: routeCursor(candidate.next.routeCursor),
    fuel: fuel === null ? null : Math.max(0, fuel),
  });
}

export function deriveMountedSeatConstraintV1(
  definition: TransportDefinitionV1,
  state: TransportStateV2,
): MountedSeatConstraintV1 | null {
  if (definition.id !== state.definitionId) throw new TypeError('Transport seat definition does not match state.');
  if (!state.rider) return null;
  const transportPose = pose(state.pose);
  const [x, y, z] = definition.seatOffset;
  const cosine = Math.cos(transportPose.yaw);
  const sine = Math.sin(transportPose.yaw);
  const seatPosition = tuple(
    [
      transportPose.position[0] + x * cosine + z * sine,
      transportPose.position[1] + y,
      transportPose.position[2] - x * sine + z * cosine,
    ],
    'Transport seat position',
  );
  if (![...seatPosition, transportPose.yaw].every(Number.isFinite))
    throw new Error('Transport seat pose is non-finite.');
  return Object.freeze({
    rider: Object.freeze({ ...state.rider }),
    walkingEnabled: false,
    pose: Object.freeze({ position: seatPosition, yaw: transportPose.yaw }),
  });
}

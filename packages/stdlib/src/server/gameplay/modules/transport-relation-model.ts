import type { EntityLifetimeReference } from '../ecs-entity-owner';
import type { TransportCheckpointV2 } from './transport-model';

export type TransportRelationFailureV1 = Readonly<{
  success: false;
  reason:
    'stale-transport' | 'stale-rider' | 'transport-occupied' | 'actor-already-mounted' | 'not-mounted' | 'no-safe-exit';
}>;

export type TransportMountCandidateV1 =
  Readonly<{ success: true; checkpoint: TransportCheckpointV2 }> | TransportRelationFailureV1;

export type TransportDismountCandidateV1 =
  | Readonly<{
      success: true;
      checkpoint: TransportCheckpointV2;
      exitPosition: readonly [number, number, number];
    }>
  | TransportRelationFailureV1;

const reference = (raw: unknown, label: string): EntityLifetimeReference => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError(`${label} is invalid.`);
  const value = raw as Record<string, unknown>;
  if (
    Object.keys(value).length !== 3 ||
    typeof value.entityId !== 'string' ||
    !value.entityId.trim() ||
    !Number.isSafeInteger(value.epoch) ||
    (value.epoch as number) <= 0 ||
    !Number.isSafeInteger(value.lifetime) ||
    (value.lifetime as number) <= 0
  )
    throw new TypeError(`${label} is invalid.`);
  return Object.freeze({
    entityId: value.entityId,
    epoch: value.epoch as number,
    lifetime: value.lifetime as number,
  });
};

const sameReference = (left: EntityLifetimeReference, right: EntityLifetimeReference): boolean =>
  left.entityId === right.entityId && left.epoch === right.epoch && left.lifetime === right.lifetime;

const replaceTransport = (
  checkpoint: TransportCheckpointV2,
  target: EntityLifetimeReference,
  rider: EntityLifetimeReference | null,
): TransportCheckpointV2 =>
  Object.freeze({
    ...checkpoint,
    transports: Object.freeze(
      checkpoint.transports.map((transport) =>
        sameReference(transport.reference, target) ? Object.freeze({ ...transport, rider }) : transport,
      ),
    ),
  });

export function buildTransportMountCandidateV1(
  checkpoint: TransportCheckpointV2,
  input: Readonly<{
    transport: EntityLifetimeReference;
    rider: EntityLifetimeReference;
    isCurrent(reference: EntityLifetimeReference): boolean;
  }>,
): TransportMountCandidateV1 {
  const transportReference = reference(input.transport, 'Mount transport reference');
  const riderReference = reference(input.rider, 'Mount rider reference');
  const transport = checkpoint.transports.find((entry) => sameReference(entry.reference, transportReference));
  if (!transport || !input.isCurrent(transportReference))
    return Object.freeze({ success: false, reason: 'stale-transport' });
  if (!input.isCurrent(riderReference)) return Object.freeze({ success: false, reason: 'stale-rider' });
  if (transportReference.entityId === riderReference.entityId)
    return Object.freeze({ success: false, reason: 'actor-already-mounted' });
  if (transport.rider) return Object.freeze({ success: false, reason: 'transport-occupied' });
  if (checkpoint.transports.some((entry) => entry.rider?.entityId === riderReference.entityId))
    return Object.freeze({ success: false, reason: 'actor-already-mounted' });
  return Object.freeze({
    success: true,
    checkpoint: replaceTransport(checkpoint, transportReference, riderReference),
  });
}

const position = (value: readonly number[]): readonly [number, number, number] => {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite))
    throw new TypeError('Transport exit position is invalid.');
  return Object.freeze([value[0], value[1], value[2]]);
};

const sortedSafeExit = (
  candidates: readonly Readonly<{ position: readonly number[]; status: 'safe' | 'blocked' | 'unknown' }>[],
): readonly [number, number, number] | null => {
  if (!Array.isArray(candidates)) throw new TypeError('Transport exit candidates are invalid.');
  const safe = candidates
    .map((candidate) => {
      if (!candidate || !['safe', 'blocked', 'unknown'].includes(candidate.status))
        throw new TypeError('Transport exit candidate is invalid.');
      return Object.freeze({ position: position(candidate.position), status: candidate.status });
    })
    .filter((candidate) => candidate.status === 'safe')
    .sort((left, right) => {
      for (let axis = 0; axis < 3; axis += 1) {
        const order = left.position[axis] - right.position[axis];
        if (order) return order;
      }
      return 0;
    });
  return safe[0]?.position ?? null;
};

export function buildTransportDismountCandidateV1(
  checkpoint: TransportCheckpointV2,
  input: Readonly<{
    rider: EntityLifetimeReference;
    exits: readonly Readonly<{ position: readonly number[]; status: 'safe' | 'blocked' | 'unknown' }>[];
    isCurrent(reference: EntityLifetimeReference): boolean;
  }>,
): TransportDismountCandidateV1 {
  const rider = reference(input.rider, 'Dismount rider reference');
  if (!input.isCurrent(rider)) return Object.freeze({ success: false, reason: 'stale-rider' });
  const transport = checkpoint.transports.find((entry) => entry.rider && sameReference(entry.rider, rider));
  if (!transport) return Object.freeze({ success: false, reason: 'not-mounted' });
  if (!input.isCurrent(transport.reference)) return Object.freeze({ success: false, reason: 'stale-transport' });
  const exitPosition = sortedSafeExit(input.exits);
  if (!exitPosition) return Object.freeze({ success: false, reason: 'no-safe-exit' });
  return Object.freeze({
    success: true,
    checkpoint: replaceTransport(checkpoint, transport.reference, null),
    exitPosition,
  });
}

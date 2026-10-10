import type { EntityStore } from './entity-store';
import type { GameplayContent } from './gameplay-content';
import type { GameplayCallbacks } from './gameplay-runtime-contracts';
import type { FrozenTransportInteractionConfig } from './modules/transport-interaction-config';
import type { TransportRelationSite } from './modules/transport-relation-interaction';
import { deriveMountedSeatConstraintV1 } from './modules/transport-motion-state';
import { bodyConfigFor } from '../../physics/body-registry';
import { loadedTransportBodyRejection, loadedWorldBodyRejection } from './transport-deployment-geometry';
import { transportBodyConfig } from './transport-body-config';

type Options = Readonly<{
  config: FrozenTransportInteractionConfig;
  entities: EntityStore;
  content: GameplayContent;
  callbacks: GameplayCallbacks;
}>;

export function projectTransportRelationSite(options: Options, entityId: string): TransportRelationSite {
  const reference = options.entities.createReference(entityId);
  const state = reference && options.entities.transportState(reference);
  if (!state) throw new Error('stale-transport');
  const definition = options.config.definitions.require(state.definitionId);
  const seat = deriveMountedSeatConstraintV1(definition, { ...state, rider: state.reference })!.pose.position;
  const local = bodyConfigFor('player').localAabb;
  const exclusion = [entityId, ...options.entities.query({ type: 'player' }).map((actor) => actor.id)];
  const rejection = (position: readonly [number, number, number], seat = false) =>
    loadedTransportBodyRejection(options, local, position, seat ? exclusion : [entityId]);
  const [x, y, z] = state.pose.position;
  const body = transportBodyConfig(definition, state.pose.yaw).localAabb;
  const xMin = body.min.x - local.max.x - 0.05;
  const xMax = body.max.x - local.min.x + 0.05;
  const zMin = body.min.z - local.max.z - 0.05;
  const zMax = body.max.z - local.min.z + 0.05;
  const positions: readonly (readonly [number, number, number])[] = [
    [x + xMin, y, z],
    [x + xMax, y, z],
    [x, y, z + zMin],
    [x, y, z + zMax],
  ];
  const exits = positions.map((position) => {
    const failed = rejection(position);
    const support = loadedWorldBodyRejection(
      options,
      { min: { ...local.min, y: -0.025 }, max: { ...local.max, y: -1e-6 } },
      position,
    );
    const status =
      failed === 'chunk-unavailable' || support === 'chunk-unavailable'
        ? 'unknown'
        : failed || support !== 'target-occupied'
          ? 'blocked'
          : 'safe';
    return Object.freeze({ position: Object.freeze([...position]) as typeof position, status });
  });
  return Object.freeze({ version: 1, state, seat, seatRejection: rejection(seat, true), exits: Object.freeze(exits) });
}

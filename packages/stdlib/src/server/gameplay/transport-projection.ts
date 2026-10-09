import type { EntityStore } from './entity-store';
import type { TransportStateV2, TransportDefinitionRegistryV1 } from './modules/transport-model';
import { deriveMountedSeatConstraintV1 } from './modules/transport-motion-state';

/** Read-only accepted states derive pose and current epoch from the canonical entity owner. */
export const projectTransportStates = (entities: EntityStore): readonly TransportStateV2[] =>
  Object.freeze(
    entities.query({ type: 'transport' }).map((entity) => {
      const reference = entities.createReference(entity.id)!;
      const state = entities.transportState(reference);
      if (!state) throw new Error('Transport projection lost its current entity lifetime.');
      return state;
    }),
  );

export function projectMountedSeatConstraints(entities: EntityStore, definitions?: TransportDefinitionRegistryV1) {
  if (!definitions) return Object.freeze([]);
  return Object.freeze(
    projectTransportStates(entities).flatMap((state) => {
      const constraint = deriveMountedSeatConstraintV1(definitions.require(state.definitionId), state);
      return constraint ? [constraint] : [];
    }),
  );
}

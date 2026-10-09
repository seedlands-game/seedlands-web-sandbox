import type { EntityLifetimeReference } from './ecs-entity-owner';
import type { EntityStore } from './entity-store';
import type { PreparedTransportReplacement } from './prepared-entity-mutation';

/** Derive replacements from current owners; publication belongs to the death series. */
export function transportDeathReplacements(
  entities: EntityStore,
  dyingActors: readonly EntityLifetimeReference[],
): readonly PreparedTransportReplacement[] {
  const lifetimes = new Map(dyingActors.map((reference) => [reference.entityId, reference.lifetime]));
  return entities.query({ type: 'transport' }).flatMap((entity) => {
    const snapshot = entities.transportComponentSnapshot(entity.id);
    if (!snapshot.rider || lifetimes.get(snapshot.rider.entityId) !== snapshot.rider.lifetime) return [];
    const reference = entities.createReference(entity.id);
    if (!reference) throw new Error('Death settlement lost the current transport lifetime.');
    return [
      Object.freeze({
        reference,
        snapshot: Object.freeze({ ...snapshot, rider: null, revision: snapshot.revision + 1 }),
      }),
    ];
  });
}

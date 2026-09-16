import type { ActorProfileRegistry } from '../gameplay/actor-profile';
import type { EntityStore } from '../gameplay/entity-store';
import { prepareCombatActionSnapshot } from './combat-action-snapshot';
import { MAX_RETAINED_ACTORS, cloneActor, type ActorState, type SimulationSnapshot } from './actor-state';

const validateActor = (actor: ActorState): void => {
  if (
    !actor.entityId?.trim() ||
    !['grazer', 'night-stalker', 'settler'].includes(actor.archetype) ||
    !Number.isFinite(actor.hunger) ||
    actor.hunger < 0 ||
    actor.hunger > 100 ||
    (actor.attackCooldownSeconds !== undefined &&
      (!Number.isFinite(actor.attackCooldownSeconds) || actor.attackCooldownSeconds < 0)) ||
    !Number.isInteger(actor.wanderIndex)
  )
    throw new TypeError('actor fields are invalid');
};

export function prepareAutonomySnapshot(raw: unknown, entities: EntityStore, profiles: ActorProfileRegistry) {
  const snapshot = raw as SimulationSnapshot;
  if (
    !snapshot ||
    snapshot.version !== 1 ||
    ![
      snapshot.time,
      snapshot.stepAccumulator,
      snapshot.needsAccumulator,
      snapshot.perceptionAccumulator,
      snapshot.behaviorAccumulator,
    ].every((value) => Number.isFinite(value) && value >= 0) ||
    !Number.isInteger(snapshot.starterEcologyVersion) ||
    snapshot.starterEcologyVersion < 0 ||
    !Array.isArray(snapshot.actors)
  )
    throw new TypeError('header is invalid');
  if (snapshot.actors.length > MAX_RETAINED_ACTORS) throw new RangeError('Autonomous actor limit exceeded.');
  const actors = new Map<string, ActorState>();
  for (const actor of snapshot.actors) {
    validateActor(actor);
    profiles.require(actor.archetype);
    const entity = entities.get(actor.entityId);
    if (!entity || entity.archetype !== actor.archetype) throw new TypeError('actor entity is missing');
    if (actors.has(actor.entityId)) throw new TypeError('duplicate actor id');
    actors.set(actor.entityId, cloneActor(actor));
  }
  return {
    snapshot,
    actors,
    actions: prepareCombatActionSnapshot(snapshot, new Set(actors.keys())),
  };
}

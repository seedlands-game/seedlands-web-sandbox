import type { AuthorityGameplayView } from '../../compute/authority-worker-protocol';
import { projectGameplayViewReference, type GameplayViewReference } from './network-reference-projection';

export const GAMEPLAY_CONSUMER_REFERENCE_VERSION = 2 as const;

const ACTOR_BEHAVIORS = [
  'idle',
  'wander',
  'seek-food',
  'flee',
  'chase',
  'attack',
  'routine-home',
  'routine-work',
] as const;

const actorBehaviorSet = new Set<string>(ACTOR_BEHAVIORS);

export type GameplayConsumerReferenceContext = Parameters<typeof projectGameplayViewReference>[1];
type ActorBehavior = (typeof ACTOR_BEHAVIORS)[number];
type PresentationActorEntity = GameplayViewReference['entities'][number] & { type: 'creature' | 'npc' };

export type ActorBehaviorReference = Readonly<{
  entityId: string;
  behavior: ActorBehavior;
}>;

export type GameplayConsumerReference = Omit<GameplayViewReference, 'kind' | 'projectionVersion'> & {
  kind: 'gameplay-consumer-reference';
  projectionVersion: typeof GAMEPLAY_CONSUMER_REFERENCE_VERSION;
  actorBehaviors: ActorBehaviorReference[];
};

const compareCodeUnits = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

const nonEmptyText = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${field} must be a non-empty string.`);
  return value;
};

const actorBehavior = (value: unknown): ActorBehavior => {
  if (typeof value !== 'string' || !actorBehaviorSet.has(value)) throw new TypeError('actor behavior is invalid.');
  return value as ActorBehavior;
};

const presentationActorEntity = (value: GameplayViewReference['entities'][number]): PresentationActorEntity => {
  if (value.type !== 'creature' && value.type !== 'npc')
    throw new TypeError('actor entity must reference a creature or npc entity.');
  return value as PresentationActorEntity;
};

/**
 * Projects the v2 reference that covers the current public actor behavior
 * consumer without changing the frozen v1 reference used by historical corpus validation.
 */
export function projectGameplayConsumerReference(
  view: AuthorityGameplayView,
  context: GameplayConsumerReferenceContext,
): GameplayConsumerReference {
  const gameplay = projectGameplayViewReference(view, context);
  if (!Array.isArray(view.actors)) throw new TypeError('gameplay actors must be an array.');

  const entities = new Map<string, GameplayViewReference['entities'][number]>();
  for (const entity of gameplay.entities) {
    if (entities.has(entity.id)) throw new TypeError(`Duplicate projected entity id: ${entity.id}`);
    entities.set(entity.id, entity);
  }
  const seen = new Set<string>();
  const actorBehaviors: ActorBehaviorReference[] = [];
  for (let index = 0; index < view.actors.length; index += 1) {
    const source = view.actors[index];
    if (!source || typeof source !== 'object') throw new TypeError('actor must be an object.');
    const entityId = nonEmptyText(source.entityId, 'actor.entityId');
    if (seen.has(entityId)) throw new TypeError(`Duplicate actor entity id: ${entityId}`);
    seen.add(entityId);

    const entity = entities.get(entityId);
    if (!entity) throw new TypeError(`Actor entity must reference a projected entity: ${entityId}`);
    const actorEntity = presentationActorEntity(entity);
    if (actorEntity.archetype === undefined || source.archetype !== actorEntity.archetype)
      throw new TypeError(`Actor archetype must match entity archetype: ${entityId}`);

    actorBehaviors.push({ entityId, behavior: actorBehavior(source.behavior) });
  }
  actorBehaviors.sort((left, right) => compareCodeUnits(left.entityId, right.entityId));

  return {
    ...gameplay,
    kind: 'gameplay-consumer-reference',
    projectionVersion: GAMEPLAY_CONSUMER_REFERENCE_VERSION,
    actorBehaviors,
  };
}

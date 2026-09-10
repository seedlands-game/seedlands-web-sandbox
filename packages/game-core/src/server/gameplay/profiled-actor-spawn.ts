import type { ActorProfileRegistry } from './actor-profile';
import type { ActorArchetype, EntitySpawn } from './entity-store';

export function resolveProfiledActorSpawn(
  input: EntitySpawn,
  profiles: ActorProfileRegistry,
  expectedArchetype: ActorArchetype | undefined = input.archetype,
): EntitySpawn {
  if (!expectedArchetype) return input;
  if (input.archetype !== expectedArchetype)
    throw new TypeError('Autonomous spawn does not match its world actor profile.');
  const profile = profiles.require(expectedArchetype);
  if (input.type !== undefined && input.type !== profile.entityType)
    throw new TypeError('Autonomous entity type does not match its world actor profile.');
  return {
    ...input,
    type: profile.entityType,
    health: input.health ?? profile.maxHealth,
    maxHealth: input.maxHealth ?? profile.maxHealth,
  };
}

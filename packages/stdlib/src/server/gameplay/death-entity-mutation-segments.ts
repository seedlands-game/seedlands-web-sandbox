import type { EntityLifetimeReference } from './ecs-entity-owner';
import type {
  PreparedActorReplacement,
  PreparedEntityMutationInput,
  PreparedTransportReplacement,
  PreparedWorldItemSpawn,
} from './prepared-entity-mutation';

/** Segment the shared death frontier without changing the owner's capacity limits. */
export function deathEntityMutationSegments(
  actors: readonly PreparedActorReplacement[],
  despawns: readonly EntityLifetimeReference[],
  spawns: readonly PreparedWorldItemSpawn[],
  transports: readonly PreparedTransportReplacement[],
): PreparedEntityMutationInput[] {
  const segments: PreparedEntityMutationInput[] = [];
  let actorOffset = 0;
  let despawnOffset = 0;
  let spawnOffset = 0;
  let transportOffset = 0;
  while (
    actorOffset < actors.length ||
    despawnOffset < despawns.length ||
    spawnOffset < spawns.length ||
    transportOffset < transports.length
  ) {
    let remaining = 128;
    const nextActors = actors.slice(actorOffset, actorOffset + remaining);
    actorOffset += nextActors.length;
    remaining -= nextActors.length;
    const nextDespawns = despawns.slice(despawnOffset, despawnOffset + remaining);
    despawnOffset += nextDespawns.length;
    remaining -= nextDespawns.length;
    const nextSpawns = spawns.slice(spawnOffset, spawnOffset + remaining);
    spawnOffset += nextSpawns.length;
    remaining -= nextSpawns.length;
    const nextTransports = transports.slice(transportOffset, transportOffset + remaining);
    transportOffset += nextTransports.length;
    segments.push(
      Object.freeze({
        ...(nextActors.length ? { actors: Object.freeze(nextActors) } : {}),
        ...(nextDespawns.length ? { despawns: Object.freeze(nextDespawns) } : {}),
        ...(nextSpawns.length ? { spawns: Object.freeze(nextSpawns) } : {}),
        ...(nextTransports.length ? { transports: Object.freeze(nextTransports) } : {}),
      }),
    );
  }
  return segments;
}

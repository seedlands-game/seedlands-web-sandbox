import type { EntityStore } from './entity-store';

/** Dynamic-entity diagnostics exclude ECS stations, which have no physics or nearby bucket. */
export function gameplayEntityMetrics(store: EntityStore) {
  const entities = store.query(),
    spatial = store.metrics();
  return {
    entityCount: entities.length,
    worldItemCount: entities.filter((entity) => entity.type === 'world-item').length,
    creatureCount: entities.filter((entity) => entity.type === 'creature').length,
    npcCount: entities.filter((entity) => entity.type === 'npc').length,
    nearbyVisitedBucketCount: spatial.visitedBucketCount,
    nearbyCandidateCount: spatial.visitedEntityCount,
    nearbyReturnedCount: spatial.returnedEntityCount,
  };
}

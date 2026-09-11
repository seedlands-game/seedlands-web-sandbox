import type { GameplayEntity } from './entity-store';

const bucketKey = (position: readonly number[]) => position.map((value) => Math.floor(value / 8)).join(',');

export function addEntityToBucket(entity: GameplayEntity, buckets: Map<string, Set<string>>): void {
  if (entity.type === 'station') return;
  const key = bucketKey(entity.position);
  const bucket = buckets.get(key) ?? new Set<string>();
  bucket.add(entity.id);
  buckets.set(key, bucket);
}

export function removeEntityFromBucket(entity: GameplayEntity, buckets: Map<string, Set<string>>): void {
  if (entity.type === 'station') return;
  const key = bucketKey(entity.position);
  const bucket = buckets.get(key);
  bucket?.delete(entity.id);
  if (bucket?.size === 0) buckets.delete(key);
}

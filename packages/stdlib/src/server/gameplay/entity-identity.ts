import type { EcsEntityOwner, EcsEntityType } from './ecs-entity-owner';
import type { EntitySpawn } from './entity-store';

export function entityIdentityFor(
  owner: EcsEntityOwner,
  input: EntitySpawn,
  type: EcsEntityType,
  sequence: number,
  blockedGeneratedIds: ReadonlySet<string> = new Set(),
): { id: string; sequence: number } {
  if (input.id !== undefined) return { id: input.id, sequence };
  let nextSequence = sequence;
  let id: string;
  do {
    nextSequence += 1;
    if (!Number.isSafeInteger(nextSequence)) throw new RangeError('Entity sequence is exhausted.');
    id = `${type}-${nextSequence}`;
  } while (owner.isIssued(id) || blockedGeneratedIds.has(id));
  return { id, sequence: nextSequence };
}

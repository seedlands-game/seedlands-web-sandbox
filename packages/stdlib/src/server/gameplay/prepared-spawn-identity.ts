import type { EcsEntityOwner } from './ecs-entity-owner';

export type PreparedSpawnIdentityContext = Readonly<{
  owner: EcsEntityOwner;
  state: { sequence: number };
  touchedIds: ReadonlySet<string>;
  explicitIds: ReadonlySet<string>;
  blockedIds: Set<string>;
}>;

/** One transient reservation shared by all spawn categories; it never writes the owner. */
export function reservePreparedSpawnId(
  explicitId: string | undefined,
  kind: 'world-item' | 'station' | 'transport',
  context: PreparedSpawnIdentityContext,
): string {
  let id = explicitId;
  if (id === undefined) {
    do {
      context.state.sequence += 1;
      if (!Number.isSafeInteger(context.state.sequence)) throw new RangeError('Entity sequence is exhausted.');
      id = `${kind}-${context.state.sequence}`;
    } while (context.owner.isIssued(id) || context.blockedIds.has(id));
  }
  if (typeof id !== 'string' || !id.trim()) throw new TypeError('Entity id must not be empty.');
  if (context.owner.get(id)) throw new Error(`Entity already exists: ${id}`);
  if (context.owner.isIssued(id)) throw new Error(`Entity id was already issued or retired: ${id}`);
  if (context.touchedIds.has(id) || (explicitId === undefined && context.explicitIds.has(id)))
    throw new TypeError(`Prepared entity mutation contains a duplicate or conflicting id: ${id}`);
  context.blockedIds.add(id);
  return id;
}

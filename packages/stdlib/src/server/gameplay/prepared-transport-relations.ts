import type { EcsEntityOwner, EcsOwnedEntity } from './ecs-entity-owner';
import type { TransportComponentV1 } from './modules/transport-model';
import { validateTransportRelations } from './ecs-transport-state';

type Options = Readonly<{
  owner: EcsEntityOwner;
  replacements: readonly Readonly<{ id: string; snapshot: TransportComponentV1 }>[];
  spawns: readonly Readonly<{ entity: EcsOwnedEntity; transport: TransportComponentV1 }>[];
  actors: readonly Readonly<{ id: string; health: number }>[];
  despawns: readonly Readonly<{ id: string }>[];
}>;

/** Checks the complete future relation set without publishing any component or allocating lifetimes. */
export function validatePreparedTransportRelations(options: Options): void {
  const states = new Map(
    options.owner
      .queryAll({ type: 'transport' })
      .map((entity) => [entity.id, options.owner.transportComponentSnapshot(entity.id)]),
  );
  const removed = new Set(options.despawns.map(({ id }) => id));
  for (const id of removed) states.delete(id);
  for (const replacement of options.replacements) states.set(replacement.id, replacement.snapshot);
  for (const spawn of options.spawns) states.set(spawn.entity.id, spawn.transport);
  if (states.size > 4096) throw new RangeError('Transport entity capacity is exhausted.');
  const health = new Map(options.actors.map((actor) => [actor.id, actor.health]));
  validateTransportRelations(
    [...states.values()],
    (reference) => {
      if (removed.has(reference.entityId)) return null;
      const entity = options.owner.resolveReference(reference);
      return entity && health.has(entity.id) ? { ...entity, health: health.get(entity.id)! } : entity;
    },
    options.owner.epoch,
  );
}

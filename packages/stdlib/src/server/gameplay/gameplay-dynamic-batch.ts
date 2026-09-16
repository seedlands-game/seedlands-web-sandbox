import type { KernelStateOwner } from '@seedlands/kernel/execution';
import type { EntityStore, EntityUpdate } from './entity-store';

export function commitGameplayDynamicBatch(
  entities: EntityStore,
  state: KernelStateOwner,
  updates: readonly Readonly<{ id: string; update: EntityUpdate }>[],
): void {
  if (!Array.isArray(updates) || updates.length < 1)
    throw new TypeError('Gameplay entity update batch must contain at least one entry.');
  state.assertGameplayBatchCapacity(state.epoch, updates.length);
  const dynamics = updates.map(({ id, update }) => {
    const reference = entities.createReference(id);
    if (!reference) throw new Error(`Unknown entity: ${id}`);
    return { reference, position: update.position, physicsVelocity: update.physicsVelocity };
  });
  const segments = Array.from({ length: Math.ceil(dynamics.length / 128) }, (_, index) => ({
    dynamics: dynamics.slice(index * 128, (index + 1) * 128),
  }));
  const mutation =
    segments.length === 1 ? entities.prepareMutation(segments[0]!) : entities.prepareMutationSeries(segments);
  mutation.validate();
  mutation.apply();
  state.commitGameplayBatch(state.epoch, updates.length);
}

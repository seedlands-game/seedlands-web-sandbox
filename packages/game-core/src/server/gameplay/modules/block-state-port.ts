import type {
  ModStateAddress,
  ObservedModState,
  PreparedRegisteredCommit,
  RegisteredCommitContext,
  RegisteredStatePort,
} from '../../composition/operation-contracts';
import type { EntityStore } from '../entity-store';
import type { ItemDefinitionRegistry } from '../item-registry';
import {
  BLOCK_ACTOR_COMPONENT,
  BLOCK_VOXEL_COMPONENT,
  BLOCK_WORLD_COMPONENT,
  BLOCK_PARTITIONS,
  BLOCK_PARTITION_SIZE,
  validateBlockActorProjection,
  validateBlockVoxelProjection,
  validateBlockWorldProjection,
} from './block-action-model';

export function createBlockStatePort(
  options: Readonly<{
    entities: EntityStore;
    items: ItemDefinitionRegistry;
    getVoxel(position: [number, number, number]): number | undefined;
    revision(): number;
    prepare(observed: readonly ObservedModState[], execution: RegisteredCommitContext): PreparedRegisteredCommit;
  }>,
) {
  const actor = (id: string) => {
    const entity = options.entities.get(id);
    if (entity?.type !== 'player') throw new TypeError('Block actor is unavailable.');
    const value = options.entities.playerStateAccess(id);
    return validateBlockActorProjection(
      {
        version: 1,
        reference: options.entities.createReference(id),
        kind: entity.type,
        position: entity.position,
        lifecycle: value.lifecycle,
        mode: { value: value.mode, revision: value.modeRevision },
        slots: value.inventory.snapshot(),
        equipment: { selectedSlot: value.selectedSlot, hotbarSize: value.hotbarSize },
        creativeCatalog: { hotbar: value.creativeCatalog.hotbar, selectedSlot: value.creativeCatalog.selectedSlot },
        breakAction: value.breakAction,
      },
      options.items,
    );
  };
  const actorIds = () => {
    const ids = options.entities
      .query({ type: 'player' })
      .map(({ id }) => id)
      .sort();
    if (ids.length > BLOCK_PARTITIONS * BLOCK_PARTITION_SIZE)
      throw new RangeError('Block player membership budget exceeded.');
    return ids;
  };
  const voxel = (position: readonly [number, number, number]) => {
    const value = options.getVoxel([...position]);
    if (value === undefined) throw new Error('chunk-unavailable');
    return validateBlockVoxelProjection({ version: 1, position, voxel: value });
  };
  const world = (partition: number) =>
    validateBlockWorldProjection({
      version: 1,
      partition,
      entries: actorIds()
        .slice(partition * BLOCK_PARTITION_SIZE, (partition + 1) * BLOCK_PARTITION_SIZE)
        .map((id) => ({
          reference: options.entities.createReference(id),
          breakAction: options.entities.playerStateAccess(id).breakAction,
        })),
    });
  const project = (address: ModStateAddress) => {
    if (
      address.componentId === BLOCK_ACTOR_COMPONENT &&
      address.target.kind === 'entity' &&
      address.partition === undefined
    )
      return actor(address.target.entityId);
    if (
      address.componentId === BLOCK_VOXEL_COMPONENT &&
      address.target.kind === 'voxel' &&
      address.partition === undefined
    )
      return voxel(address.target.position);
    if (
      address.componentId === BLOCK_WORLD_COMPONENT &&
      address.target.kind === 'world' &&
      Number.isSafeInteger(address.partition) &&
      address.partition! >= 0 &&
      address.partition! < BLOCK_PARTITIONS
    )
      return world(address.partition!);
    throw new TypeError('Unsupported Block projection address.');
  };
  let sequence = 0;
  const observations = new Map<number, Readonly<{ address: string; signature: string }>>();
  const signature = (address: ModStateAddress, value = project(address)) =>
    JSON.stringify([options.revision(), address, value]);
  const validate = (observed: readonly ObservedModState[]) => {
    const seen = new Set<string>();
    for (const entry of observed) {
      const key = JSON.stringify(entry.address),
        receipt = observations.get(entry.revision);
      if (seen.has(key) || !receipt || receipt.address !== key || receipt.signature !== signature(entry.address))
        throw new Error('Block projection observation is stale.');
      seen.add(key);
    }
  };
  const state = Object.freeze<RegisteredStatePort>({
    read(address) {
      const value = project(address);
      if (sequence >= Number.MAX_SAFE_INTEGER) throw new RangeError('Block observation capacity exhausted.');
      const revision = ++sequence;
      observations.set(revision, { address: JSON.stringify(address), signature: signature(address, value) });
      while (observations.size > 128) observations.delete(observations.keys().next().value!);
      return { revision, value };
    },
    commit: () => ({ ok: false, reason: 'Blocks require a prepared commit.' }),
    prepareCommit(observed, writes, execution) {
      if (writes.length)
        return { ok: false, code: 'BLOCK_WRITE_FORBIDDEN', reason: 'Block operations return candidates, not writes.' };
      validate(observed);
      const plan = options.prepare(observed, execution);
      if (!plan.ok) return plan;
      return Object.freeze({
        ...plan,
        validate() {
          validate(observed);
          plan.validate();
        },
      });
    },
  });
  return Object.freeze({ state, actor, voxel, world, actorIds });
}

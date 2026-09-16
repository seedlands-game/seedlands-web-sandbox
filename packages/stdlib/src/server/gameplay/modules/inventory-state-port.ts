import { prepareEntityMutationSeries, type PreparedEntityMutationInput } from '../prepared-entity-mutation';
import type {
  RegisteredStatePort,
  ModStateAddress,
  ObservedModState,
  ModStateWrite,
  PreparedRegisteredCommit,
} from '../../composition/operation-contracts';
import type { ModuleInvocationValue } from '../../composition/contracts';
import type { EntityStore } from '../entity-store';
import type { ItemDefinitionRegistry } from '../item-registry';
import { createInventoryCandidate } from './inventory-api';

type Owner = Readonly<{
  entities: EntityStore;
  items: ItemDefinitionRegistry;
  revision(): number;
  assertCanChange(): void;
  prepareCancellation(actorIds: readonly string[]): Readonly<{ validate(): void; apply(): void }>;
  changed(): void;
}>;
const keyFor = (address: ModStateAddress): string => {
  if (address.componentId !== 'seedlands:inventory' || address.target.kind !== 'entity')
    throw new TypeError('Unsupported inventory state address.');
  return address.target.entityId;
};

export function createInventoryStatePort(owner: Owner): RegisteredStatePort {
  const revisions = new Map<string, Readonly<{ signature: string; token: number }>>();
  let sequence = 0;
  const read = (address: ModStateAddress) => {
    const id = keyFor(address);
    const identity = owner.entities.createReference(id);
    if (!identity) throw new TypeError('Inventory actor is unavailable.');
    const inventory = owner.entities.actorStateAccess(id).inventory;
    const slots = inventory.snapshot();
    const signature = JSON.stringify([identity.epoch, identity.lifetime, owner.revision(), slots]);
    const previous = revisions.get(id);
    if (previous?.signature !== signature) {
      if (sequence >= Number.MAX_SAFE_INTEGER) throw new RangeError('Inventory observation sequence is exhausted.');
      revisions.set(id, { signature, token: ++sequence });
    }
    return { revision: revisions.get(id)!.token, value: slots, inventory };
  };
  function prepare(
    observed: readonly ObservedModState[],
    writes: readonly ModStateWrite[],
    value: ModuleInvocationValue,
  ): PreparedRegisteredCommit {
    const expected = new Map<string, number>();
    const prepared: Array<Readonly<{ id: string; slots: ReturnType<typeof read>['value'] }>> = [];
    try {
      for (const entry of observed) {
        const id = keyFor(entry.address);
        if (expected.has(id) || read(entry.address).revision !== entry.revision)
          return { ok: false, code: 'STATE_CONFLICT', reason: 'stale-state' };
        expected.set(id, entry.revision);
      }
      const written = new Set<string>();
      for (const entry of writes) {
        const id = keyFor(entry.address);
        if (!expected.has(id) || written.has(id))
          return { ok: false, code: 'STATE_CONFLICT', reason: 'unobserved-or-duplicate-write' };
        written.add(id);
        const live = read(entry.address);
        if (live.revision !== expected.get(id)) return { ok: false, code: 'STATE_CONFLICT', reason: 'stale-state' };
        const candidate = createInventoryCandidate(owner.items, entry.value);
        if (candidate.capacity !== live.inventory.capacity)
          return { ok: false, code: 'STATE_CONFLICT', reason: 'inventory-capacity-mismatch' };
        prepared.push({ id, slots: candidate.snapshot() });
      }
    } catch {
      return { ok: false, code: 'STATE_CONFLICT', reason: 'invalid-inventory-candidate' };
    }
    const capturedRevision = owner.revision();
    let mutation: ReturnType<typeof prepareEntityMutationSeries> | undefined;
    let cancellation: ReturnType<Owner['prepareCancellation']> | undefined;
    if (prepared.length) {
      owner.assertCanChange();
      const changedEquipment = prepared
        .filter(({ id, slots }) => {
          const actor = owner.entities.actorStateAccess(id);
          return JSON.stringify(actor.inventory.slot(actor.selectedSlot)) !== JSON.stringify(slots[actor.selectedSlot]);
        })
        .map(({ id }) => id);
      if (changedEquipment.length) cancellation = owner.prepareCancellation(changedEquipment);
      const actors = prepared.map(({ id, slots }) => ({
        reference: owner.entities.createReference(id)!,
        health: owner.entities.actorStateAccess(id).health,
        components: { ...owner.entities.actorComponentSnapshot(id), inventory: slots },
      }));
      const segments: PreparedEntityMutationInput[] = [];
      for (let offset = 0; offset < actors.length; offset += 128)
        segments.push({ actors: actors.slice(offset, offset + 128) });
      mutation = prepareEntityMutationSeries(owner.entities, segments);
    }
    let validated = false,
      used = false;
    return {
      ok: true,
      revision: capturedRevision + Number(prepared.length > 0),
      value,
      validate() {
        validated = false;
        if (
          used ||
          owner.revision() !== capturedRevision ||
          observed.some((entry) => read(entry.address).revision !== entry.revision)
        )
          throw new Error('Prepared inventory transaction is stale.');
        if (mutation) owner.assertCanChange();
        mutation?.validate();
        cancellation?.validate();
        validated = true;
      },
      apply() {
        if (used || !validated) throw new Error('Prepared inventory transaction requires validation.');
        mutation?.apply();
        cancellation?.apply();
        if (mutation) owner.changed();
        used = true;
      },
    };
  }
  return Object.freeze({
    read: (address: ModStateAddress) => {
      const snapshot = read(address);
      return { revision: snapshot.revision, value: snapshot.value };
    },
    prepareCommit: (observed, writes, execution) => prepare(observed, writes, execution.candidateValue),
    commit(observed, writes) {
      const plan = prepare(observed, writes, null);
      if (!plan.ok) return plan;
      plan.validate();
      plan.apply();
      return { ok: true, revision: plan.revision };
    },
  });
}

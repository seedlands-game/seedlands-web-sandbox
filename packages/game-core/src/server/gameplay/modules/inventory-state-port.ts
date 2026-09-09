import type {
  RegisteredStatePort,
  ModStateAddress,
  ObservedModState,
  ModStateWrite,
} from '../../composition/operation-contracts';
import type { EntityStore } from '../entity-store';
import type { ItemDefinitionRegistry } from '../item-registry';
import { createInventoryCandidate } from './inventory-api';

type Owner = Readonly<{ entities: EntityStore; items: ItemDefinitionRegistry; revision(): number; changed(): void }>;
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
  function commit(observed: readonly ObservedModState[], writes: readonly ModStateWrite[]) {
    const expected = new Map<string, number>();
    const prepared: Array<
      Readonly<{ inventory: ReturnType<typeof read>['inventory']; slots: ReturnType<typeof read>['value'] }>
    > = [];
    try {
      for (const entry of observed) {
        const id = keyFor(entry.address);
        if (expected.has(id) || read(entry.address).revision !== entry.revision)
          return { ok: false as const, reason: 'stale-state' };
        expected.set(id, entry.revision);
      }
      const written = new Set<string>();
      for (const entry of writes) {
        const id = keyFor(entry.address);
        if (!expected.has(id) || written.has(id))
          return { ok: false as const, reason: 'unobserved-or-duplicate-write' };
        written.add(id);
        const live = read(entry.address);
        if (live.revision !== expected.get(id)) return { ok: false as const, reason: 'stale-state' };
        const candidate = createInventoryCandidate(owner.items, entry.value);
        if (candidate.capacity !== live.inventory.capacity)
          return { ok: false as const, reason: 'inventory-capacity-mismatch' };
        prepared.push({ inventory: live.inventory, slots: candidate.snapshot() });
      }
    } catch {
      return { ok: false as const, reason: 'invalid-inventory-candidate' };
    }
    // All inputs and owner references are checked in this synchronous phase before the first replacement.
    for (const entry of prepared) entry.inventory.replace(entry.slots);
    if (prepared.length) owner.changed();
    return { ok: true as const, revision: owner.revision() };
  }
  return Object.freeze({
    read: (address: ModStateAddress) => {
      const snapshot = read(address);
      return { revision: snapshot.revision, value: snapshot.value };
    },
    commit,
  });
}

import type { RegisteredStatePort, ModStateAddress } from '../../composition/operation-contracts';
import type { EntityStore } from '../entity-store';
import type { ModeRuntime } from './mode-runtime';
import { validateActorModeFacets } from '../ecs-actor-state';
import type { ActorModeSnapshotFacets } from '../ecs-actor-components';
import { MODE_COMPONENT } from './mode-module';

export function createModeStatePort(
  entities: EntityStore,
  modes: ModeRuntime,
  revision: () => number,
): RegisteredStatePort {
  let token = 0;
  const observations = new Map<string, { signature: string; token: number }>();
  const idFor = (address: ModStateAddress) => {
    if (address.componentId !== MODE_COMPONENT || address.target.kind !== 'entity')
      throw new TypeError('Unsupported mode address.');
    return address.target.entityId;
  };
  const read = (address: ModStateAddress) => {
    const id = idFor(address),
      actor = entities.actorStateAccess(id),
      reference = entities.createReference(id);
    const value = {
      mode: { version: 1 as const, value: actor.mode, revision: actor.modeRevision },
      creativeCatalog: actor.creativeCatalog,
      flight: actor.flight,
    };
    const signature = JSON.stringify([reference, revision(), value]);
    if (observations.get(id)?.signature !== signature) {
      if (token >= Number.MAX_SAFE_INTEGER) throw new RangeError('Mode observation sequence exhausted.');
      observations.set(id, { signature, token: ++token });
    }
    return { revision: observations.get(id)!.token, value };
  };
  return Object.freeze({
    read,
    commit(observed, writes) {
      // This participant admits one actor mode transition; mode transitions preserve survival inventory.
      if (writes.length !== 1 || observed.length !== 1 || idFor(writes[0].address) !== idFor(observed[0].address))
        return { ok: false, reason: 'mode-transaction-scope' };
      const id = idFor(writes[0].address),
        current = read(writes[0].address);
      if (current.revision !== observed[0].revision) return { ok: false, reason: 'stale-state' };
      const next = validateActorModeFacets(writes[0].value as ActorModeSnapshotFacets, entities.items);
      const previous = current.value;
      let result;
      if (next.mode.value !== previous.mode.value) {
        const expected = {
          mode: { ...previous.mode, value: next.mode.value, revision: previous.mode.revision + 1 },
          creativeCatalog:
            next.mode.value === 'creative'
              ? { ...next.creativeCatalog, revision: previous.creativeCatalog.revision + 1 }
              : previous.creativeCatalog,
          flight: {
            ...previous.flight,
            enabled: next.flight.enabled,
            revision: previous.flight.revision + Number(previous.flight.enabled !== next.flight.enabled),
          },
        };
        if (JSON.stringify(next) !== JSON.stringify(expected)) return { ok: false, reason: 'invalid-mode-transition' };
        result = modes.switchMode(
          id,
          next.mode.value === 'survival'
            ? { mode: 'survival' }
            : {
                mode: 'creative',
                creativeHotbar: next.creativeCatalog.hotbar,
                selectedCreativeSlot: next.creativeCatalog.selectedSlot,
                flightEnabled: next.flight.enabled,
              },
        );
      } else if (JSON.stringify(next.creativeCatalog) !== JSON.stringify(previous.creativeCatalog)) {
        if (
          next.mode.value !== 'creative' ||
          JSON.stringify(next.mode) !== JSON.stringify(previous.mode) ||
          JSON.stringify(next.flight) !== JSON.stringify(previous.flight) ||
          next.creativeCatalog.revision !== previous.creativeCatalog.revision + 1
        )
          return { ok: false, reason: 'invalid-catalog-transition' };
        result = modes.setCreativeCatalog(id, next.creativeCatalog.hotbar, next.creativeCatalog.selectedSlot);
      } else {
        if (
          next.mode.value !== 'creative' ||
          JSON.stringify(next.mode) !== JSON.stringify(previous.mode) ||
          next.flight.revision !== previous.flight.revision + Number(next.flight.enabled !== previous.flight.enabled)
        )
          return { ok: false, reason: 'invalid-flight-transition' };
        result = modes.setFlight(id, next.flight.enabled);
      }
      return result.success ? { ok: true, revision: revision() } : { ok: false, reason: result.reason };
    },
  });
}

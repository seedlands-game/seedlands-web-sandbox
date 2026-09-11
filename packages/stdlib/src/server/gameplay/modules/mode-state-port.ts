import type {
  ModStateAddress,
  ModStateWrite,
  ObservedModState,
  PreparedRegisteredCommit,
  RegisteredCommitContext,
  RegisteredStatePort,
} from '../../composition/operation-contracts';
import type { ModuleInvocationValue } from '../../composition/contracts';
import type { EntityStore } from '../entity-store';
import type { ActorModeSnapshotFacets } from '../ecs-actor-components';
import { validateActorModeFacets } from '../ecs-actor-state';
import type { ModeRuntime, PreparedModeRuntimeResult } from './mode-runtime';
import { MODE_COMPONENT } from './mode-module';

type CompleteModeFacets = Required<ActorModeSnapshotFacets>;

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

const freezeFacets = (facets: CompleteModeFacets): CompleteModeFacets =>
  Object.freeze({
    mode: Object.freeze({ ...facets.mode }),
    creativeCatalog: Object.freeze({
      ...facets.creativeCatalog,
      hotbar: Object.freeze([...facets.creativeCatalog.hotbar]),
    }),
    flight: Object.freeze({ ...facets.flight }),
  });

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
    const value = freezeFacets({
      mode: { version: 1 as const, value: actor.mode, revision: actor.modeRevision },
      creativeCatalog: actor.creativeCatalog,
      flight: actor.flight,
    });
    const signature = JSON.stringify([reference, revision(), value]);
    if (observations.get(id)?.signature !== signature) {
      if (token >= Number.MAX_SAFE_INTEGER) throw new RangeError('Mode observation sequence exhausted.');
      observations.set(id, { signature, token: ++token });
    }
    return { revision: observations.get(id)!.token, value };
  };

  const prepare = (
    observed: readonly ObservedModState[],
    writes: readonly ModStateWrite[],
  ):
    | Readonly<{ ok: false; reason: string }>
    | Readonly<{
        ok: true;
        plan: Extract<PreparedModeRuntimeResult, { success: true }>;
        value: ModuleInvocationValue;
        revision: number;
      }> => {
    if (writes.length !== 1 || observed.length !== 1 || idFor(writes[0].address) !== idFor(observed[0].address))
      return { ok: false, reason: 'mode-transaction-scope' };
    const id = idFor(writes[0].address),
      current = read(writes[0].address);
    if (current.revision !== observed[0].revision) return { ok: false, reason: 'stale-state' };
    const next = validateActorModeFacets(writes[0].value as ActorModeSnapshotFacets, entities.items);
    const previous = current.value;
    let result: PreparedModeRuntimeResult;
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
      if (!same(next, expected)) return { ok: false, reason: 'invalid-mode-transition' };
      result = modes.prepareSwitchMode(
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
    } else if (!same(next.creativeCatalog, previous.creativeCatalog)) {
      if (
        next.mode.value !== 'creative' ||
        !same(next.mode, previous.mode) ||
        !same(next.flight, previous.flight) ||
        next.creativeCatalog.revision !== previous.creativeCatalog.revision + 1
      )
        return { ok: false, reason: 'invalid-catalog-transition' };
      result = modes.prepareSetCreativeCatalog(id, next.creativeCatalog.hotbar, next.creativeCatalog.selectedSlot);
    } else {
      if (
        next.mode.value !== 'creative' ||
        !same(next.mode, previous.mode) ||
        next.flight.revision !== previous.flight.revision + Number(next.flight.enabled !== previous.flight.enabled)
      )
        return { ok: false, reason: 'invalid-flight-transition' };
      result = modes.prepareSetFlight(id, next.flight.enabled);
    }
    if (!result.success) return { ok: false, reason: result.reason };
    const value = Object.freeze({ mode: result.state.mode, modeRevision: result.state.modeRevision });
    const currentRevision = revision();
    if (result.changesState && currentRevision >= Number.MAX_SAFE_INTEGER)
      throw new RangeError('Mode revision capacity is exhausted.');
    return {
      ok: true,
      plan: result,
      value,
      revision: currentRevision + Number(result.changesState),
    };
  };

  return Object.freeze<RegisteredStatePort>({
    read,
    prepareCommit(observed, writes, execution: RegisteredCommitContext): PreparedRegisteredCommit {
      const prepared = prepare(observed, writes);
      if (!prepared.ok) return { ok: false, code: 'MODE_STATE_CONFLICT', reason: prepared.reason };
      if (!same(execution.candidateValue, prepared.value))
        return {
          ok: false,
          code: 'MODE_CANDIDATE_INVALID',
          reason: 'Mode operation result does not match its final state.',
        };
      return Object.freeze({
        ok: true as const,
        revision: prepared.revision,
        value: prepared.value,
        validate() {
          if (observed.some((entry) => read(entry.address).revision !== entry.revision))
            throw new Error('Prepared mode observation is stale.');
          prepared.plan.validate();
        },
        apply: () => {
          prepared.plan.apply();
        },
      });
    },
    commit(observed, writes) {
      const prepared = prepare(observed, writes);
      if (!prepared.ok) return prepared;
      prepared.plan.validate();
      prepared.plan.apply();
      return { ok: true, revision: revision() };
    },
  });
}

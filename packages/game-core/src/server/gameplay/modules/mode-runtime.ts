import { validateActorModeFacets } from '../ecs-actor-state';
import type {
  ActorComponentSnapshot,
  ActorFlightComponentV1,
  ActorMode,
  ActorModeComponentV1,
  ActorModeSnapshotFacets,
  CreativeCatalogComponentV1,
} from '../ecs-actor-components';
import type { EntityStore } from '../entity-store';
import type { ItemId } from '../item-registry';

type Position = [number, number, number];
type CompleteModeFacets = Required<ActorModeSnapshotFacets>;

export type ActorModeState = Readonly<{
  mode: ActorMode;
  modeRevision: number;
  creativeCatalog: CreativeCatalogComponentV1;
  flight: ActorFlightComponentV1;
}>;

export type ModeSwitchRequest =
  | Readonly<{
      mode: 'creative';
      creativeHotbar: readonly (ItemId | null)[];
      selectedCreativeSlot?: number;
      flightEnabled?: boolean;
    }>
  | Readonly<{ mode: 'survival' }>;

export type ModeRuntimeResult =
  | Readonly<{ success: true; state: ActorModeState }>
  | Readonly<{
      success: false;
      reason:
        | 'unknown-actor'
        | 'already-in-mode'
        | 'invalid-catalog'
        | 'no-safe-landing'
        | 'flight-requires-creative'
        | 'creative-required';
    }>;

export type PreparedModeParticipant = Readonly<{
  validate(): void;
  apply(): void;
}>;

export type PreparedModeRuntimeResult =
  | Extract<ModeRuntimeResult, { success: false }>
  | Readonly<{
      success: true;
      state: ActorModeState;
      changesState: boolean;
      validate(): void;
      apply(): Extract<ModeRuntimeResult, { success: true }>;
    }>;

type ModeRuntimeBaseOptions = Readonly<{
  entities: EntityStore;
  findSafeLanding: (actorId: string, currentPosition: Position) => Position | null;
  assertCanChange?: (actorId: string) => void;
  changed: (actorId: string) => void;
}>;

type PreparedCancellationOptions = Readonly<{
  prepareCancelIncompatibleActions: (actorId: string, reason: 'mode-changed') => PreparedModeParticipant;
  cancelIncompatibleActions?: never;
}>;

/** Standalone migration compatibility. Composed hosts must provide a prepared cancellation participant. */
type LegacyCancellationOptions = Readonly<{
  prepareCancelIncompatibleActions?: undefined;
  cancelIncompatibleActions: (actorId: string, reason: 'mode-changed') => void;
}>;

export type ModeRuntimeOptions = ModeRuntimeBaseOptions & (PreparedCancellationOptions | LegacyCancellationOptions);

const frozenState = (facets: CompleteModeFacets): ActorModeState =>
  Object.freeze({
    mode: facets.mode.value,
    modeRevision: facets.mode.revision,
    creativeCatalog: Object.freeze({
      ...facets.creativeCatalog,
      hotbar: Object.freeze([...facets.creativeCatalog.hotbar]),
    }),
    flight: Object.freeze({ ...facets.flight }),
  });

const noParticipant: PreparedModeParticipant = Object.freeze({
  validate: () => undefined,
  apply: () => undefined,
});

export class ModeRuntime {
  constructor(private readonly options: ModeRuntimeOptions) {}

  stateFor(actorId: string): ActorModeState {
    const actor = this.options.entities.actorStateAccess(actorId);
    return this.project(actor);
  }

  prepareSwitchMode(actorId: string, request: ModeSwitchRequest): PreparedModeRuntimeResult {
    if (request.mode !== 'creative' && request.mode !== 'survival') throw new TypeError('Unknown actor mode.');
    const entity = this.options.entities.get(actorId);
    if (!entity || entity.type === 'world-item') return { success: false, reason: 'unknown-actor' };
    const actor = this.options.entities.actorStateAccess(actorId);
    if (actor.mode === request.mode) return { success: false, reason: 'already-in-mode' };

    const current = this.project(actor);
    let landing: Position | undefined;
    let mode: ActorModeComponentV1;
    let catalog = current.creativeCatalog;
    let flight: ActorFlightComponentV1;
    if (request.mode === 'creative') {
      const hotbar = this.catalog(request.creativeHotbar, request.selectedCreativeSlot ?? 0);
      if (!hotbar) return { success: false, reason: 'invalid-catalog' };
      const enabled = request.flightEnabled ?? false;
      mode = { version: 1, value: 'creative', revision: current.modeRevision + 1 };
      catalog = {
        version: 1,
        hotbar: hotbar.hotbar,
        selectedSlot: hotbar.selectedSlot,
        revision: current.creativeCatalog.revision + 1,
      };
      flight = {
        version: 1,
        enabled,
        revision: current.flight.revision + Number(current.flight.enabled !== enabled),
      };
    } else {
      const candidate = this.options.findSafeLanding(actorId, [...entity.position]);
      if (!this.validPosition(candidate)) return { success: false, reason: 'no-safe-landing' };
      landing = [...candidate];
      mode = { version: 1, value: 'survival', revision: current.modeRevision + 1 };
      flight = {
        version: 1,
        enabled: false,
        revision: current.flight.revision + Number(current.flight.enabled),
      };
    }

    const facets = validateActorModeFacets({ mode, creativeCatalog: catalog, flight }, this.options.entities.items);
    const snapshot = this.options.entities.actorComponentSnapshot(actorId);
    return this.prepare(actorId, entity.health!, this.modeComponents(snapshot, facets, true), facets, {
      cancel: true,
      position: landing,
      physicsVelocity: [0, 0, 0],
    });
  }

  switchMode(actorId: string, request: ModeSwitchRequest): ModeRuntimeResult {
    return this.commit(this.prepareSwitchMode(actorId, request));
  }

  prepareSetCreativeCatalog(
    actorId: string,
    hotbar: readonly (ItemId | null)[],
    selectedSlot = 0,
  ): PreparedModeRuntimeResult {
    const validated = this.catalog(hotbar, selectedSlot);
    if (!validated) return { success: false, reason: 'invalid-catalog' };
    const entity = this.actorEntity(actorId);
    if (!entity) return { success: false, reason: 'unknown-actor' };
    const actor = this.options.entities.actorStateAccess(actorId);
    const current = this.project(actor);
    const facets = validateActorModeFacets(
      {
        mode: { version: 1, value: current.mode, revision: current.modeRevision },
        creativeCatalog: {
          version: 1,
          hotbar: validated.hotbar,
          selectedSlot: validated.selectedSlot,
          revision: current.creativeCatalog.revision + 1,
        },
        flight: current.flight,
      },
      this.options.entities.items,
    );
    const snapshot = this.options.entities.actorComponentSnapshot(actorId);
    return this.prepare(actorId, entity.health!, this.modeComponents(snapshot, facets, false), facets);
  }

  setCreativeCatalog(actorId: string, hotbar: readonly (ItemId | null)[], selectedSlot = 0): ModeRuntimeResult {
    return this.commit(this.prepareSetCreativeCatalog(actorId, hotbar, selectedSlot));
  }

  selectCreativeSlot(actorId: string, slot: number): ModeRuntimeResult {
    const actor = this.actor(actorId);
    if (!actor) return { success: false, reason: 'unknown-actor' };
    const current = this.project(actor);
    if (current.mode !== 'creative') return { success: false, reason: 'creative-required' };
    if (!Number.isSafeInteger(slot) || slot < 0 || slot >= 8) return { success: false, reason: 'invalid-catalog' };
    if (current.creativeCatalog.selectedSlot === slot) return { success: true, state: current };
    return this.setCreativeCatalog(actorId, current.creativeCatalog.hotbar, slot);
  }

  prepareSetFlight(actorId: string, enabled: boolean): PreparedModeRuntimeResult {
    if (typeof enabled !== 'boolean') throw new TypeError('Flight enabled must be boolean.');
    const entity = this.actorEntity(actorId);
    if (!entity) return { success: false, reason: 'unknown-actor' };
    const actor = this.options.entities.actorStateAccess(actorId);
    const current = this.project(actor);
    if (enabled && current.mode !== 'creative') return { success: false, reason: 'flight-requires-creative' };
    if (current.flight.enabled === enabled) return this.noChange(actorId, current);
    const facets = validateActorModeFacets(
      {
        mode: { version: 1, value: current.mode, revision: current.modeRevision },
        creativeCatalog: current.creativeCatalog,
        flight: { version: 1, enabled, revision: current.flight.revision + 1 },
      },
      this.options.entities.items,
    );
    const snapshot = this.options.entities.actorComponentSnapshot(actorId);
    return this.prepare(actorId, entity.health!, this.modeComponents(snapshot, facets, false), facets);
  }

  setFlight(actorId: string, enabled: boolean): ModeRuntimeResult {
    return this.commit(this.prepareSetFlight(actorId, enabled));
  }

  private prepare(
    actorId: string,
    health: number,
    components: ActorComponentSnapshot,
    facets: CompleteModeFacets,
    spatial: Readonly<{
      cancel?: boolean;
      position?: Position;
      physicsVelocity?: Position;
    }> = {},
  ): PreparedModeRuntimeResult {
    this.options.assertCanChange?.(actorId);
    const reference = this.options.entities.createReference(actorId);
    if (!reference) return { success: false, reason: 'unknown-actor' };
    const entityPlan = this.options.entities.prepareMutation({
      actors: [
        {
          reference,
          health,
          components,
          ...(spatial.position ? { position: spatial.position } : {}),
          ...(spatial.physicsVelocity ? { physicsVelocity: spatial.physicsVelocity } : {}),
        },
      ],
    });
    const cancellation = spatial.cancel ? this.prepareCancellation(actorId) : noParticipant;
    const state = frozenState(facets);
    let phase: 'open' | 'validated' | 'used' = 'open';
    return Object.freeze({
      success: true as const,
      state,
      changesState: true,
      validate: () => {
        if (phase === 'used') throw new Error('Prepared mode transition was already used or applied.');
        phase = 'open';
        this.options.assertCanChange?.(actorId);
        if (spatial.position) {
          const entity = this.options.entities.get(actorId);
          const landing = entity && this.options.findSafeLanding(actorId, [...entity.position]);
          if (!this.validPosition(landing) || landing.some((value, index) => value !== spatial.position![index]))
            throw new Error('Prepared mode landing is stale.');
        }
        entityPlan.validate();
        cancellation.validate();
        phase = 'validated';
      },
      apply: () => {
        if (phase === 'open') throw new Error('Prepared mode transition must validate before apply.');
        if (phase === 'used') throw new Error('Prepared mode transition was already used or applied.');
        phase = 'used';
        entityPlan.apply();
        cancellation.apply();
        this.options.changed(actorId);
        return Object.freeze({ success: true as const, state });
      },
    });
  }

  private noChange(actorId: string, state: ActorModeState): PreparedModeRuntimeResult {
    const reference = this.options.entities.createReference(actorId)!;
    const assertFresh = () => {
      if (
        !this.options.entities.resolveReference(reference) ||
        JSON.stringify(this.stateFor(actorId)) !== JSON.stringify(state)
      )
        throw new Error('Prepared mode no-op is stale.');
    };
    let phase: 'open' | 'validated' | 'used' = 'open';
    return Object.freeze({
      success: true as const,
      state,
      changesState: false,
      validate() {
        if (phase === 'used') throw new Error('Prepared mode transition was already used or applied.');
        phase = 'open';
        assertFresh();
        phase = 'validated';
      },
      apply() {
        if (phase === 'open') throw new Error('Prepared mode transition must validate before apply.');
        if (phase === 'used') throw new Error('Prepared mode transition was already used or applied.');
        assertFresh();
        phase = 'used';
        return Object.freeze({ success: true as const, state });
      },
    });
  }

  private prepareCancellation(actorId: string): PreparedModeParticipant {
    if (this.options.prepareCancelIncompatibleActions)
      return this.options.prepareCancelIncompatibleActions(actorId, 'mode-changed');
    const cancel = this.options.cancelIncompatibleActions;
    if (!cancel) throw new Error('Mode cancellation participant is not configured.');
    return Object.freeze({
      validate: () => undefined,
      apply: () => cancel(actorId, 'mode-changed'),
    });
  }

  private commit(prepared: PreparedModeRuntimeResult): ModeRuntimeResult {
    if (!prepared.success) return prepared;
    prepared.validate();
    return prepared.apply();
  }

  private actorEntity(actorId: string) {
    const entity = this.options.entities.get(actorId);
    return entity && entity.type !== 'world-item' ? entity : null;
  }

  private actor(actorId: string) {
    return this.actorEntity(actorId) ? this.options.entities.actorStateAccess(actorId) : null;
  }

  private modeComponents(
    snapshot: ActorComponentSnapshot,
    facets: CompleteModeFacets,
    clearBreakAction: boolean,
  ): ActorComponentSnapshot {
    return {
      ...snapshot,
      mode: facets.mode,
      creativeCatalog: facets.creativeCatalog,
      flight: facets.flight,
      player: snapshot.player && clearBreakAction ? { ...snapshot.player, breakAction: null } : snapshot.player,
    };
  }

  private catalog(hotbar: readonly (ItemId | null)[], selectedSlot: number) {
    if (
      !Array.isArray(hotbar) ||
      hotbar.length !== 8 ||
      !Number.isSafeInteger(selectedSlot) ||
      selectedSlot < 0 ||
      selectedSlot >= hotbar.length ||
      [...hotbar].some((itemId) => itemId !== null && !this.options.entities.items.has(itemId))
    )
      return null;
    return { hotbar: Object.freeze([...hotbar]), selectedSlot };
  }

  private project(actor: ReturnType<EntityStore['actorStateAccess']>): ActorModeState {
    return frozenState({
      mode: { version: 1, value: actor.mode, revision: actor.modeRevision },
      creativeCatalog: actor.creativeCatalog,
      flight: actor.flight,
    });
  }

  private validPosition(value: Position | null): value is Position {
    return value !== null && value.length === 3 && value.every(Number.isFinite);
  }
}

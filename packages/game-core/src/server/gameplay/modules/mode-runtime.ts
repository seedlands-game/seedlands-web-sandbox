import { validateActorModeFacets } from '../ecs-actor-state';
import type {
  ActorFlightComponentV1,
  ActorMode,
  ActorModeComponentV1,
  CreativeCatalogComponentV1,
} from '../ecs-actor-components';
import type { EntityStore } from '../entity-store';
import type { ItemId } from '../item-registry';

type Position = [number, number, number];

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

export type ModeRuntimeOptions = Readonly<{
  entities: EntityStore;
  findSafeLanding: (actorId: string, currentPosition: Position) => Position | null;
  cancelIncompatibleActions: (actorId: string, reason: 'mode-changed') => void;
  changed: (actorId: string) => void;
}>;

export class ModeRuntime {
  constructor(private readonly options: ModeRuntimeOptions) {}

  stateFor(actorId: string): ActorModeState {
    const actor = this.options.entities.actorStateAccess(actorId);
    return this.project(actor);
  }

  switchMode(actorId: string, request: ModeSwitchRequest): ModeRuntimeResult {
    if (request.mode !== 'creative' && request.mode !== 'survival') throw new TypeError('Unknown actor mode.');
    const entity = this.options.entities.get(actorId);
    if (!entity || entity.type === 'world-item') return { success: false, reason: 'unknown-actor' };
    const reference = this.options.entities.createReference(actorId)!;
    const actor = this.options.entities.actorStateAccess(actorId);
    if (actor.mode === request.mode) return { success: false, reason: 'already-in-mode' };

    const current = this.project(actor);
    let landing: Position | null = null;
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
      landing = this.options.findSafeLanding(actorId, [...entity.position]);
      if (!this.validPosition(landing)) return { success: false, reason: 'no-safe-landing' };
      mode = { version: 1, value: 'survival', revision: current.modeRevision + 1 };
      flight = {
        version: 1,
        enabled: false,
        revision: current.flight.revision + Number(current.flight.enabled),
      };
    }

    if (this.options.entities.resolveReference(reference)?.id !== actorId)
      return { success: false, reason: 'unknown-actor' };
    const candidate = validateActorModeFacets({ mode, creativeCatalog: catalog, flight }, this.options.entities.items);
    this.options.cancelIncompatibleActions(actorId, 'mode-changed');
    if (this.options.entities.resolveReference(reference)?.id !== actorId)
      throw new Error('Actor identity changed while committing a mode transition.');
    this.options.entities.update(actorId, { ...(landing ? { position: landing } : {}), physicsVelocity: [0, 0, 0] });
    actor.replaceModeComponents(candidate);
    this.options.changed(actorId);
    return { success: true, state: this.project(actor) };
  }

  setCreativeCatalog(actorId: string, hotbar: readonly (ItemId | null)[], selectedSlot = 0): ModeRuntimeResult {
    const validated = this.catalog(hotbar, selectedSlot);
    if (!validated) return { success: false, reason: 'invalid-catalog' };
    const actor = this.actor(actorId);
    if (!actor) return { success: false, reason: 'unknown-actor' };
    const current = this.project(actor);
    actor.replaceModeComponents({
      mode: { version: 1, value: current.mode, revision: current.modeRevision },
      creativeCatalog: {
        version: 1,
        hotbar: validated.hotbar,
        selectedSlot: validated.selectedSlot,
        revision: current.creativeCatalog.revision + 1,
      },
      flight: current.flight,
    });
    this.options.changed(actorId);
    return { success: true, state: this.project(actor) };
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

  setFlight(actorId: string, enabled: boolean): ModeRuntimeResult {
    const actor = this.actor(actorId);
    if (!actor) return { success: false, reason: 'unknown-actor' };
    const current = this.project(actor);
    if (enabled && current.mode !== 'creative') return { success: false, reason: 'flight-requires-creative' };
    actor.replaceModeComponents({
      mode: { version: 1, value: current.mode, revision: current.modeRevision },
      creativeCatalog: current.creativeCatalog,
      flight: { version: 1, enabled, revision: current.flight.revision + Number(current.flight.enabled !== enabled) },
    });
    if (current.flight.enabled !== enabled) this.options.changed(actorId);
    return { success: true, state: this.project(actor) };
  }

  private actor(actorId: string) {
    const entity = this.options.entities.get(actorId);
    return entity && entity.type !== 'world-item' ? this.options.entities.actorStateAccess(actorId) : null;
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
    return {
      mode: actor.mode,
      modeRevision: actor.modeRevision,
      creativeCatalog: actor.creativeCatalog,
      flight: actor.flight,
    };
  }

  private validPosition(value: Position | null): value is Position {
    return value !== null && value.length === 3 && value.every(Number.isFinite);
  }
}

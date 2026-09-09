import { addComponents, type World } from 'bitecs';
import { Inventory, createInventoryAccess } from './inventory';
import type { ItemDefinitionRegistry } from './item-registry';
import type { GameplayEntity } from './entity-store';
import {
  type ActorComponentAccess,
  type ActorComponentSnapshot,
  type ActorFlightComponentV1,
  type ActorModeComponentV1,
  type ActorModeSnapshotFacets,
  type ActorNeeds,
  type CreativeCatalogComponentV1,
  type PlayerComponentAccess,
  type createActorComponents,
} from './ecs-actor-components';
import type { BreakAction } from './player-state';

type Components = ReturnType<typeof createActorComponents>;
const CREATIVE_HOTBAR_SIZE = 8;

const defaultModeFacets = () => ({
  mode: { version: 1 as const, value: 'survival' as const, revision: 0 },
  creativeCatalog: {
    version: 1 as const,
    hotbar: Object.freeze(Array.from({ length: CREATIVE_HOTBAR_SIZE }, () => null)),
    selectedSlot: 0,
    revision: 0,
  },
  flight: { version: 1 as const, enabled: false, revision: 0 },
});

export function initializeActorComponents(
  world: World,
  components: Components,
  eid: number,
  entity: GameplayEntity,
  items: ItemDefinitionRegistry,
): void {
  if (entity.type === 'world-item') return;
  const player = entity.type === 'player';
  addComponents(
    world,
    eid,
    components.needs,
    components.inventory,
    components.equipment,
    components.control,
    components.life,
    components.mode,
    components.creativeCatalog,
    components.flight,
  );
  components.needs.hunger[eid] = player ? 20 : 0;
  components.needs.maxHunger[eid] = player ? 20 : 100;
  components.needs.hungerMeaning[eid] = player ? 'satiety' : 'deficit';
  components.needs.hungerAccumulator[eid] = 0;
  components.needs.healingAccumulator[eid] = 0;
  components.needs.starvationAccumulator[eid] = 0;
  components.inventory.value[eid] = new Inventory(24, undefined, items);
  components.equipment.selectedSlot[eid] = 0;
  components.equipment.hotbarSize[eid] = 8;
  components.control.source[eid] = player ? 'player' : 'autonomous';
  components.life.lifecycle[eid] = entity.health === 0 ? 'dead' : 'alive';
  writeModeFacets(components, eid, defaultModeFacets());
  if (player) {
    addComponents(world, eid, components.player);
    [components.player.spawnX[eid], components.player.spawnY[eid], components.player.spawnZ[eid]] = entity.position;
    components.player.breakAction[eid] = null;
  }
}

export function clearActorComponents(components: Components, eid: number): void {
  for (const component of Object.values(components)) {
    for (const values of Object.values(component)) delete values[eid];
  }
}

const within = (value: number, maximum: number, field: string): number => {
  if (!Number.isFinite(value) || value < 0 || value > maximum) throw new TypeError(`Invalid actor ${field}.`);
  return value;
};
const selectedSlot = (components: Components, eid: number, value: number): boolean =>
  Number.isInteger(value) && value >= 0 && value < components.equipment.hotbarSize[eid]!;

export function readActorNeeds(components: Components, eid: number): ActorNeeds {
  const needs = components.needs;
  return {
    hunger: needs.hunger[eid]!,
    maxHunger: needs.maxHunger[eid]!,
    hungerMeaning: needs.hungerMeaning[eid]!,
    hungerAccumulator: needs.hungerAccumulator[eid]!,
    healingAccumulator: needs.healingAccumulator[eid]!,
    starvationAccumulator: needs.starvationAccumulator[eid]!,
  };
}

export function readActorComponentSnapshot(
  components: Components,
  eid: number,
  entityId: string,
  player: boolean,
): ActorComponentSnapshot {
  const inventory = components.inventory.value[eid];
  if (!inventory) throw new Error(`Actor inventory component is missing: ${entityId}`);
  return {
    entityId,
    needs: readActorNeeds(components, eid),
    inventory: inventory.snapshot(),
    equipment: {
      selectedSlot: components.equipment.selectedSlot[eid]!,
      hotbarSize: components.equipment.hotbarSize[eid]!,
    },
    lifecycle: components.life.lifecycle[eid]!,
    controlSource: components.control.source[eid]!,
    mode: readMode(components, eid),
    creativeCatalog: readCreativeCatalog(components, eid),
    flight: readFlight(components, eid),
    ...(player
      ? {
          player: {
            spawnPosition: [
              components.player.spawnX[eid]!,
              components.player.spawnY[eid]!,
              components.player.spawnZ[eid]!,
            ],
            breakAction: copyBreakAction(components.player.breakAction[eid]),
          },
        }
      : {}),
  };
}

export type PreparedActorComponentSnapshot = Readonly<{
  entityId: string;
  needs: ActorNeeds;
  inventory: Inventory;
  equipment: Readonly<{ selectedSlot: number; hotbarSize: number }>;
  lifecycle: ActorComponentSnapshot['lifecycle'];
  controlSource: ActorComponentSnapshot['controlSource'];
  modeFacets: CompleteModeFacets;
  player: Readonly<{ spawnPosition: [number, number, number]; breakAction: BreakAction | null }> | null;
}>;

export function prepareActorComponentSnapshot(
  snapshot: ActorComponentSnapshot,
  player: boolean,
  items: ItemDefinitionRegistry,
): PreparedActorComponentSnapshot {
  const needs = snapshot.needs;
  if (
    !needs ||
    !Number.isFinite(needs.maxHunger) ||
    needs.maxHunger <= 0 ||
    needs.maxHunger !== (player ? 20 : 100) ||
    (needs.hungerMeaning !== 'satiety' && needs.hungerMeaning !== 'deficit') ||
    needs.hungerMeaning !== (player ? 'satiety' : 'deficit') ||
    !Number.isFinite(needs.hunger) ||
    needs.hunger < 0 ||
    needs.hunger > needs.maxHunger ||
    ![needs.hungerAccumulator, needs.healingAccumulator, needs.starvationAccumulator].every(
      (value) => Number.isFinite(value) && value >= 0,
    )
  )
    throw new TypeError('Actor needs snapshot is invalid.');
  if (
    !snapshot.equipment ||
    !Number.isSafeInteger(snapshot.equipment.hotbarSize) ||
    snapshot.equipment.hotbarSize <= 0 ||
    snapshot.equipment.hotbarSize !== 8 ||
    !Number.isSafeInteger(snapshot.equipment.selectedSlot) ||
    snapshot.equipment.selectedSlot < 0 ||
    snapshot.equipment.selectedSlot >= snapshot.equipment.hotbarSize
  )
    throw new TypeError('Actor equipment snapshot is invalid.');
  if (snapshot.lifecycle !== 'alive' && snapshot.lifecycle !== 'dead')
    throw new TypeError('Actor lifecycle snapshot is invalid.');
  if (!['player', 'autonomous', 'none'].includes(snapshot.controlSource))
    throw new TypeError('Actor control snapshot is invalid.');
  if (player !== Boolean(snapshot.player)) throw new TypeError('Player component snapshot membership is invalid.');
  if (!Array.isArray(snapshot.inventory) || snapshot.inventory.length !== 24)
    throw new TypeError('Actor inventory snapshot is invalid.');

  const inventory = new Inventory(24, snapshot.inventory, items);
  const modeFacets = validateActorModeFacets(snapshot, items);
  let preparedPlayer: PreparedActorComponentSnapshot['player'] = null;
  if (snapshot.player) {
    if (snapshot.player.spawnPosition.length !== 3 || !snapshot.player.spawnPosition.every(Number.isFinite))
      throw new TypeError('Player spawn position component is invalid.');
    preparedPlayer = Object.freeze({
      spawnPosition: [
        snapshot.player.spawnPosition[0],
        snapshot.player.spawnPosition[1],
        snapshot.player.spawnPosition[2],
      ],
      breakAction: copyBreakAction(snapshot.player.breakAction),
    });
  }
  return Object.freeze({
    entityId: snapshot.entityId,
    needs: Object.freeze({ ...needs }),
    inventory,
    equipment: Object.freeze({ ...snapshot.equipment }),
    lifecycle: snapshot.lifecycle,
    controlSource: snapshot.controlSource,
    modeFacets: Object.freeze({
      mode: Object.freeze({ ...modeFacets.mode }),
      creativeCatalog: Object.freeze({
        ...modeFacets.creativeCatalog,
        hotbar: Object.freeze([...modeFacets.creativeCatalog.hotbar]),
      }),
      flight: Object.freeze({ ...modeFacets.flight }),
    }),
    player: preparedPlayer,
  });
}

export function installPreparedActorComponentSnapshot(
  components: Components,
  eid: number,
  prepared: PreparedActorComponentSnapshot,
): void {
  const { needs } = prepared;
  components.needs.hunger[eid] = needs.hunger;
  components.needs.maxHunger[eid] = needs.maxHunger;
  components.needs.hungerMeaning[eid] = needs.hungerMeaning;
  components.needs.hungerAccumulator[eid] = needs.hungerAccumulator;
  components.needs.healingAccumulator[eid] = needs.healingAccumulator;
  components.needs.starvationAccumulator[eid] = needs.starvationAccumulator;
  components.inventory.value[eid] = prepared.inventory;
  components.equipment.selectedSlot[eid] = prepared.equipment.selectedSlot;
  components.equipment.hotbarSize[eid] = prepared.equipment.hotbarSize;
  components.life.lifecycle[eid] = prepared.lifecycle;
  components.control.source[eid] = prepared.controlSource;
  writeModeFacets(components, eid, prepared.modeFacets);
  if (prepared.player) {
    components.player.spawnX[eid] = prepared.player.spawnPosition[0];
    components.player.spawnY[eid] = prepared.player.spawnPosition[1];
    components.player.spawnZ[eid] = prepared.player.spawnPosition[2];
    components.player.breakAction[eid] = prepared.player.breakAction
      ? { ...prepared.player.breakAction, position: [...prepared.player.breakAction.position] }
      : null;
  }
}

export function restoreActorComponentSnapshot(
  components: Components,
  eid: number,
  snapshot: ActorComponentSnapshot,
  player: boolean,
  items: ItemDefinitionRegistry,
): void {
  installPreparedActorComponentSnapshot(components, eid, prepareActorComponentSnapshot(snapshot, player, items));
}

export type ActorAccessBindings = Readonly<{
  resolve: () => number;
  health: () => Readonly<{ health: number; maxHealth: number }>;
  setHealth: (value: number) => void;
}>;

type CompleteModeFacets = Readonly<{
  mode: ActorModeComponentV1;
  creativeCatalog: CreativeCatalogComponentV1;
  flight: ActorFlightComponentV1;
}>;

const validRevision = (value: number) => Number.isSafeInteger(value) && value >= 0;

export function validateActorModeFacets(
  facets: ActorModeSnapshotFacets,
  items: ItemDefinitionRegistry,
): CompleteModeFacets {
  const supplied = [facets.mode, facets.creativeCatalog, facets.flight].filter((value) => value !== undefined).length;
  if (supplied === 0) return defaultModeFacets();
  if (supplied !== 3) throw new TypeError('Actor mode component snapshots must be supplied together.');
  const mode = facets.mode!;
  const catalog = facets.creativeCatalog!;
  const flight = facets.flight!;
  if (mode.version !== 1 || !['survival', 'creative'].includes(mode.value) || !validRevision(mode.revision))
    throw new TypeError('Actor mode component snapshot is invalid.');
  if (
    catalog.version !== 1 ||
    !Array.isArray(catalog.hotbar) ||
    catalog.hotbar.length !== CREATIVE_HOTBAR_SIZE ||
    !Number.isSafeInteger(catalog.selectedSlot) ||
    catalog.selectedSlot < 0 ||
    catalog.selectedSlot >= CREATIVE_HOTBAR_SIZE ||
    !validRevision(catalog.revision) ||
    [...catalog.hotbar].some((itemId) => itemId !== null && (typeof itemId !== 'string' || !items.has(itemId)))
  )
    throw new TypeError('Creative catalog component snapshot is invalid.');
  if (flight.version !== 1 || typeof flight.enabled !== 'boolean' || !validRevision(flight.revision))
    throw new TypeError('Actor flight component snapshot is invalid.');
  if (mode.value === 'survival' && flight.enabled)
    throw new TypeError('Survival actor cannot have creative flight enabled.');
  return {
    mode: { ...mode },
    creativeCatalog: { ...catalog, hotbar: Object.freeze([...catalog.hotbar]) },
    flight: { ...flight },
  };
}

const readMode = (components: Components, eid: number): ActorModeComponentV1 => ({
  version: 1,
  value: components.mode.value[eid]!,
  revision: components.mode.revision[eid]!,
});

const readCreativeCatalog = (components: Components, eid: number): CreativeCatalogComponentV1 => ({
  version: 1,
  hotbar: Object.freeze([...(components.creativeCatalog.hotbar[eid] ?? [])]),
  selectedSlot: components.creativeCatalog.selectedSlot[eid]!,
  revision: components.creativeCatalog.revision[eid]!,
});

const readFlight = (components: Components, eid: number): ActorFlightComponentV1 => ({
  version: 1,
  enabled: components.flight.enabled[eid]!,
  revision: components.flight.revision[eid]!,
});

function writeModeFacets(components: Components, eid: number, facets: CompleteModeFacets): void {
  components.mode.value[eid] = facets.mode.value;
  components.mode.revision[eid] = facets.mode.revision;
  components.creativeCatalog.hotbar[eid] = Object.freeze([...facets.creativeCatalog.hotbar]);
  components.creativeCatalog.selectedSlot[eid] = facets.creativeCatalog.selectedSlot;
  components.creativeCatalog.revision[eid] = facets.creativeCatalog.revision;
  components.flight.enabled[eid] = facets.flight.enabled;
  components.flight.revision[eid] = facets.flight.revision;
}

/** The bound resolver checks epoch and lifetime on each read/write, including retained inventory handles. */
export function createActorStateAccess(components: Components, binding: ActorAccessBindings): ActorComponentAccess {
  const inventory = createInventoryAccess(() => {
    const value = components.inventory.value[binding.resolve()];
    if (!value) throw new RangeError('Actor inventory component is missing.');
    return value;
  });
  return Object.freeze({
    get health() {
      binding.resolve();
      return binding.health().health;
    },
    set health(value: number) {
      binding.resolve();
      binding.setHealth(value);
    },
    get maxHealth() {
      binding.resolve();
      return binding.health().maxHealth;
    },
    get lifecycle() {
      return components.life.lifecycle[binding.resolve()]!;
    },
    set lifecycle(value: 'alive' | 'dead') {
      if (value !== 'alive' && value !== 'dead') throw new TypeError('Invalid actor lifecycle.');
      components.life.lifecycle[binding.resolve()] = value;
    },
    get hunger() {
      return components.needs.hunger[binding.resolve()]!;
    },
    set hunger(value: number) {
      const eid = binding.resolve();
      components.needs.hunger[eid] = within(value, components.needs.maxHunger[eid]!, 'hunger');
    },
    get maxHunger() {
      return components.needs.maxHunger[binding.resolve()]!;
    },
    get hungerMeaning() {
      return components.needs.hungerMeaning[binding.resolve()]!;
    },
    get selectedSlot() {
      return components.equipment.selectedSlot[binding.resolve()]!;
    },
    set selectedSlot(value: number) {
      const eid = binding.resolve();
      if (!selectedSlot(components, eid, value)) throw new RangeError('Invalid actor selected slot.');
      components.equipment.selectedSlot[eid] = value;
    },
    get hotbarSize() {
      return components.equipment.hotbarSize[binding.resolve()]!;
    },
    get inventory() {
      binding.resolve();
      return inventory;
    },
    get controlSource() {
      return components.control.source[binding.resolve()]!;
    },
    get mode() {
      return components.mode.value[binding.resolve()]!;
    },
    get modeRevision() {
      return components.mode.revision[binding.resolve()]!;
    },
    get creativeCatalog() {
      return readCreativeCatalog(components, binding.resolve());
    },
    get flight() {
      return readFlight(components, binding.resolve());
    },
    selectSlot(value: number) {
      const eid = binding.resolve();
      if (!selectedSlot(components, eid, value)) return false;
      components.equipment.selectedSlot[eid] = value;
      return true;
    },
    replaceModeComponents(facets: ActorModeSnapshotFacets) {
      const eid = binding.resolve();
      writeModeFacets(components, eid, validateActorModeFacets(facets, inventory.items));
    },
  });
}

const copyBreakAction = (value: BreakAction | null | undefined): BreakAction | null => {
  if (value === null || value === undefined) return null;
  if (
    value.position.length !== 3 ||
    !value.position.every(Number.isFinite) ||
    !Number.isInteger(value.voxel) ||
    value.voxel < 0 ||
    !Number.isFinite(value.elapsedSeconds) ||
    value.elapsedSeconds < 0 ||
    !Number.isFinite(value.requiredSeconds) ||
    value.requiredSeconds < 0
  )
    throw new TypeError('Invalid player break action component.');
  return { ...value, position: [...value.position] };
};

export function createPlayerStateAccess(components: Components, binding: ActorAccessBindings): PlayerComponentAccess {
  const actor = createActorStateAccess(components, binding);
  const player = {
    get spawnPosition(): [number, number, number] {
      const eid = binding.resolve();
      return [components.player.spawnX[eid]!, components.player.spawnY[eid]!, components.player.spawnZ[eid]!];
    },
    set spawnPosition(value: [number, number, number]) {
      if (value.length !== 3 || !value.every(Number.isFinite)) throw new TypeError('Invalid player spawn position.');
      const eid = binding.resolve();
      [components.player.spawnX[eid], components.player.spawnY[eid], components.player.spawnZ[eid]] = value;
    },
    get hungerAccumulator() {
      return components.needs.hungerAccumulator[binding.resolve()]!;
    },
    set hungerAccumulator(value: number) {
      components.needs.hungerAccumulator[binding.resolve()] = within(value, Infinity, 'hunger accumulator');
    },
    get healingAccumulator() {
      return components.needs.healingAccumulator[binding.resolve()]!;
    },
    set healingAccumulator(value: number) {
      components.needs.healingAccumulator[binding.resolve()] = within(value, Infinity, 'healing accumulator');
    },
    get starvationAccumulator() {
      return components.needs.starvationAccumulator[binding.resolve()]!;
    },
    set starvationAccumulator(value: number) {
      components.needs.starvationAccumulator[binding.resolve()] = within(value, Infinity, 'starvation accumulator');
    },
    get breakAction() {
      return copyBreakAction(components.player.breakAction[binding.resolve()]);
    },
    set breakAction(value: BreakAction | null) {
      components.player.breakAction[binding.resolve()] = copyBreakAction(value);
    },
  };
  // Copy descriptors, not values: all access remains bound to the single ECS owner.
  return Object.freeze(
    Object.defineProperties(player, Object.getOwnPropertyDescriptors(actor)),
  ) as PlayerComponentAccess;
}

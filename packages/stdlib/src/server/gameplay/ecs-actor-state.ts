import { validateDurableExecutionOrigin } from '../composition/execution-origin';
import { addComponents, type World } from 'bitecs';
import { Inventory, createInventoryAccess } from './inventory';
import type { ItemDefinitionRegistry } from './item-registry';
import type { GameplayEntity } from './entity-store';
import {
  type ActorComponentAccess,
  type ActorComponentSnapshot,
  type ActorModeSnapshotFacets,
  type ActorNeeds,
  type PlayerComponentAccess,
  type createActorComponents,
} from './ecs-actor-components';
import type { BreakAction } from './player-state';
import {
  emptyInventoryCursor,
  validateInventoryCursor,
  type InventoryCursorV1,
} from './modules/inventory-pointer-contract';
import {
  cloneCharacterComponentState,
  validateCharacterComponentState,
} from '../simulation/character-runtime-validation';
import type { CharacterComponentStateV1 } from '../simulation/character-runtime-types';
import {
  defaultActorModeFacets,
  readActorCreativeCatalog,
  readActorFlight,
  readActorMode,
  validateActorModeFacets,
  writeActorModeFacets,
  type CompleteModeFacets,
} from './ecs-actor-mode-state';
export { validateActorModeFacets } from './ecs-actor-mode-state';

type Components = ReturnType<typeof createActorComponents>;

export const isActorEntityType = (
  type: GameplayEntity['type'],
): type is Extract<GameplayEntity['type'], 'player' | 'creature' | 'npc'> =>
  type === 'player' || type === 'creature' || type === 'npc';

export function initializeActorComponents(
  world: World,
  components: Components,
  eid: number,
  entity: GameplayEntity,
  items: ItemDefinitionRegistry,
): void {
  if (!isActorEntityType(entity.type)) return;
  const player = entity.type === 'player';
  addComponents(
    world,
    eid,
    components.needs,
    components.inventory,
    components.equipment,
    components.control,
    components.behavior,
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
  components.inventory.revision[eid] = 0;
  components.inventory.cursor[eid] = emptyInventoryCursor();
  components.equipment.selectedSlot[eid] = 0;
  components.equipment.hotbarSize[eid] = 8;
  components.control.source[eid] = player ? 'player' : 'autonomous';
  components.control.revision[eid] = 0;
  components.behavior.value[eid] = undefined;
  components.life.lifecycle[eid] = entity.health === 0 ? 'dead' : 'alive';
  writeActorModeFacets(components, eid, defaultActorModeFacets());
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
    inventoryRevision: components.inventory.revision[eid]!,
    inventoryCursor: validateInventoryCursor(components.inventory.cursor[eid], inventory.items),
    equipment: {
      selectedSlot: components.equipment.selectedSlot[eid]!,
      hotbarSize: components.equipment.hotbarSize[eid]!,
    },
    lifecycle: components.life.lifecycle[eid]!,
    controlSource: components.control.source[eid]!,
    controlRevision: components.control.revision[eid]!,
    ...(components.behavior.value[eid]
      ? { character: cloneCharacterComponentState(components.behavior.value[eid]!) }
      : {}),
    mode: readActorMode(components, eid),
    creativeCatalog: readActorCreativeCatalog(components, eid),
    flight: readActorFlight(components, eid),
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
  inventoryRevision: number;
  inventoryCursor: InventoryCursorV1;
  equipment: Readonly<{ selectedSlot: number; hotbarSize: number }>;
  lifecycle: ActorComponentSnapshot['lifecycle'];
  controlSource: ActorComponentSnapshot['controlSource'];
  controlRevision: number;
  character: CharacterComponentStateV1 | null;
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
  if (!['player', 'autonomous', 'behavior', 'none'].includes(snapshot.controlSource))
    throw new TypeError('Actor control snapshot is invalid.');
  const controlRevision = snapshot.controlRevision ?? 0;
  if (!Number.isSafeInteger(controlRevision) || controlRevision < 0)
    throw new TypeError('Actor control revision is invalid.');
  const character = snapshot.character ? validateCharacterComponentState(snapshot.character) : null;
  if ((snapshot.controlSource === 'behavior') !== Boolean(character))
    throw new TypeError('Actor behavior state and control source must be installed together.');
  if (character && (player || character.entityId !== snapshot.entityId || character.lifecycle !== 'active'))
    throw new TypeError('Actor behavior component identity is invalid.');
  if (player !== Boolean(snapshot.player)) throw new TypeError('Player component snapshot membership is invalid.');
  if (!Array.isArray(snapshot.inventory) || snapshot.inventory.length !== 24)
    throw new TypeError('Actor inventory snapshot is invalid.');

  const inventory = new Inventory(24, snapshot.inventory, items);
  const inventoryRevision = snapshot.inventoryRevision ?? 0;
  if (!Number.isSafeInteger(inventoryRevision) || inventoryRevision < 0)
    throw new TypeError('Actor inventory revision is invalid.');
  const inventoryCursor = validateInventoryCursor(snapshot.inventoryCursor, items);
  if (inventoryCursor.origin?.kind === 'inventory' && inventoryCursor.origin.slot >= inventory.capacity)
    throw new TypeError('Actor inventory cursor origin is invalid.');
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
    inventoryRevision,
    inventoryCursor,
    equipment: Object.freeze({ ...snapshot.equipment }),
    lifecycle: snapshot.lifecycle,
    controlSource: snapshot.controlSource,
    controlRevision,
    character,
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
  preserveCharacterBinding = false,
): void {
  const boundCharacter = components.behavior.value[eid];
  if (preserveCharacterBinding && JSON.stringify(boundCharacter ?? null) !== JSON.stringify(prepared.character))
    throw new Error('Prepared actor mutation changed the Character behavior component.');
  const { needs } = prepared;
  components.needs.hunger[eid] = needs.hunger;
  components.needs.maxHunger[eid] = needs.maxHunger;
  components.needs.hungerMeaning[eid] = needs.hungerMeaning;
  components.needs.hungerAccumulator[eid] = needs.hungerAccumulator;
  components.needs.healingAccumulator[eid] = needs.healingAccumulator;
  components.needs.starvationAccumulator[eid] = needs.starvationAccumulator;
  components.inventory.value[eid] = prepared.inventory;
  components.inventory.revision[eid] = prepared.inventoryRevision;
  components.inventory.cursor[eid] = prepared.inventoryCursor;
  components.equipment.selectedSlot[eid] = prepared.equipment.selectedSlot;
  components.equipment.hotbarSize[eid] = prepared.equipment.hotbarSize;
  components.life.lifecycle[eid] = prepared.lifecycle;
  components.control.source[eid] = prepared.controlSource;
  components.control.revision[eid] = prepared.controlRevision;
  if (!preserveCharacterBinding)
    components.behavior.value[eid] = prepared.character ? cloneCharacterComponentState(prepared.character) : undefined;
  writeActorModeFacets(components, eid, prepared.modeFacets);
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
    get inventoryRevision() {
      return components.inventory.revision[binding.resolve()]!;
    },
    get inventoryCursor() {
      const eid = binding.resolve();
      return validateInventoryCursor(components.inventory.cursor[eid], inventory.items);
    },
    get controlSource() {
      return components.control.source[binding.resolve()]!;
    },
    get controlRevision() {
      return components.control.revision[binding.resolve()]!;
    },
    get mode() {
      return components.mode.value[binding.resolve()]!;
    },
    get modeRevision() {
      return components.mode.revision[binding.resolve()]!;
    },
    get creativeCatalog() {
      return readActorCreativeCatalog(components, binding.resolve());
    },
    get flight() {
      return readActorFlight(components, binding.resolve());
    },
    selectSlot(value: number) {
      const eid = binding.resolve();
      if (!selectedSlot(components, eid, value)) return false;
      components.equipment.selectedSlot[eid] = value;
      return true;
    },
    replaceModeComponents(facets: ActorModeSnapshotFacets) {
      const eid = binding.resolve();
      writeActorModeFacets(components, eid, validateActorModeFacets(facets, inventory.items));
    },
    replaceInventoryInteraction(revision: number, cursor: InventoryCursorV1) {
      if (!Number.isSafeInteger(revision) || revision < 0) throw new TypeError('Invalid actor inventory revision.');
      const eid = binding.resolve();
      components.inventory.revision[eid] = revision;
      components.inventory.cursor[eid] = validateInventoryCursor(cursor, inventory.items);
    },
    replaceControl(source: import('./ecs-actor-components').ActorControlSource, expectedRevision?: number) {
      const eid = binding.resolve();
      const revision = components.control.revision[eid]!;
      if (expectedRevision !== undefined && expectedRevision !== revision)
        throw new Error('Actor control revision changed.');
      if (revision >= Number.MAX_SAFE_INTEGER) throw new RangeError('Actor control revision is exhausted.');
      components.control.source[eid] = source;
      return (components.control.revision[eid] = revision + 1);
    },
  });
}

export function readActorCharacterComponent(components: Components, eid: number): CharacterComponentStateV1 | null {
  const value = components.behavior.value[eid];
  return value ? cloneCharacterComponentState(value) : null;
}

/** Runtime-only binding to the ECS-owned object; callers must not retain it beyond this world lifetime. */
export function bindActorCharacterComponent(components: Components, eid: number): CharacterComponentStateV1 | null {
  return components.behavior.value[eid] ?? null;
}

export function installActorCharacterComponent(
  components: Components,
  eid: number,
  value: CharacterComponentStateV1 | null,
  expectedControlRevision?: number,
): CharacterComponentStateV1 | null {
  const revision = components.control.revision[eid]!;
  if (expectedControlRevision !== undefined && expectedControlRevision !== revision)
    throw new Error('Actor control revision changed.');
  if (revision >= Number.MAX_SAFE_INTEGER) throw new RangeError('Actor control revision is exhausted.');
  const prepared = value ? validateCharacterComponentState(value) : null;
  components.behavior.value[eid] = prepared ?? undefined;
  components.control.source[eid] = prepared ? 'behavior' : 'none';
  components.control.revision[eid] = revision + 1;
  return prepared ? components.behavior.value[eid]! : null;
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
  return {
    ...value,
    position: [...value.position],
    ...(value.origin === undefined ? {} : { origin: validateDurableExecutionOrigin(value.origin) }),
  };
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

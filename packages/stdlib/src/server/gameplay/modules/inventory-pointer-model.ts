import type { StationComponentV1 } from '../ecs-station-state';
import { Inventory, type InventorySlot } from '../inventory';
import { sameItemStackIdentity } from '../item-instance';
import type { GameplayContent } from '../gameplay-content';
import type { ItemDefinitionRegistry, ItemStack } from '../item-registry';
import {
  createStationCraftCandidate,
  matchesShapedStationRecipe,
  matchesShapelessStationRecipe,
} from './station-candidates';
import {
  validateInventoryCursor,
  validateInventoryPointerInput,
  type InventoryCursorOriginV1,
  type InventoryPointerActorProjectionV1,
  type InventoryPointerCandidateV1,
  type InventoryPointerCommand,
  type InventoryPointerSlotRef,
  type InventoryPointerStationProjectionV1,
} from './inventory-pointer-contract';
export * from './inventory-pointer-contract';
export { settleInventoryCursor, type SettledInventoryCursorV1 } from './inventory-cursor-settlement';
import { settleInventoryCursor } from './inventory-cursor-settlement';

const integer = (value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

function frozenStack(stack: Readonly<ItemStack> | null): InventorySlot {
  return stack
    ? Object.freeze({
        ...stack,
        ...(stack.instance ? { instance: Object.freeze({ ...stack.instance }) } : {}),
      })
    : null;
}

type MutableState = {
  slots: InventorySlot[];
  cursorStack: InventorySlot;
  cursorOrigin: InventoryCursorOriginV1 | null;
  station: StationComponentV1 | null;
  stationSlots: InventorySlot[] | null;
  drops: ItemStack[];
  crafted: number;
};

function stationSlots(component: StationComponentV1): InventorySlot[] {
  return component.kind === 'workbench'
    ? [...component.grid]
    : component.kind === 'chest'
      ? [...component.slots]
      : [component.furnace.input, component.furnace.fuel, component.furnace.output];
}

function current(state: MutableState, ref: InventoryPointerSlotRef): InventorySlot {
  const values = ref.kind === 'inventory' ? state.slots : state.stationSlots;
  if (!values || ref.slot >= values.length) throw new Error('invalid-pointer-slot');
  return values[ref.slot] ?? null;
}

function write(state: MutableState, ref: InventoryPointerSlotRef, value: InventorySlot): void {
  const values = ref.kind === 'inventory' ? state.slots : state.stationSlots;
  if (!values || ref.slot >= values.length) throw new Error('invalid-pointer-slot');
  values[ref.slot] = value ? { ...value, ...(value.instance ? { instance: { ...value.instance } } : {}) } : null;
}

function originFor(
  ref: InventoryPointerSlotRef,
  station: InventoryPointerStationProjectionV1 | undefined,
): InventoryCursorOriginV1 {
  return ref.kind === 'inventory'
    ? Object.freeze({ kind: 'inventory', slot: ref.slot })
    : Object.freeze({ kind: 'station', reference: Object.freeze({ ...station!.reference }), slot: ref.slot });
}

function canPlaceStation(
  content: GameplayContent,
  station: StationComponentV1,
  slot: number,
  stack: ItemStack,
): boolean {
  if (station.kind !== 'furnace') return true;
  if (slot === 0) {
    const recipe = content.stations!.codec.furnace.recipeForInput(stack.itemId);
    return !!recipe && sameItemStackIdentity(recipe.input, stack);
  }
  if (slot === 1) return !!content.stations!.codec.furnace.fuel(stack.itemId);
  return false;
}

function assertCanPlace(
  content: GameplayContent,
  state: MutableState,
  ref: InventoryPointerSlotRef,
  stack: ItemStack,
): void {
  if (ref.kind === 'station' && (!state.station || !canPlaceStation(content, state.station, ref.slot, stack)))
    throw new Error('invalid-station-slot');
}

function capacity(items: ItemDefinitionRegistry, target: InventorySlot, stack: ItemStack): number {
  if (target && !sameItemStackIdentity(target, stack)) return 0;
  return items.require(stack.itemId).stackLimit - (target?.count ?? 0);
}

function put(content: GameplayContent, state: MutableState, ref: InventoryPointerSlotRef, count: number): number {
  const stack = state.cursorStack;
  if (!stack) return 0;
  assertCanPlace(content, state, ref, stack);
  const target = current(state, ref);
  if (target && !sameItemStackIdentity(target, stack)) throw new Error('destination-occupied');
  const moved = Math.min(count, stack.count, Math.max(0, capacity(content.items, target, stack)));
  if (moved === 0) return 0;
  write(state, ref, { ...stack, count: (target?.count ?? 0) + moved });
  state.cursorStack = stack.count === moved ? null : { ...stack, count: stack.count - moved };
  if (!state.cursorStack) state.cursorOrigin = null;
  return moved;
}

function click(
  content: GameplayContent,
  state: MutableState,
  station: InventoryPointerStationProjectionV1 | undefined,
  command: Extract<InventoryPointerCommand, { kind: 'click' }>,
): void {
  const target = current(state, command.slot);
  if (!state.cursorStack) {
    if (!target) throw new Error('empty-source-slot');
    const count = command.button === 0 ? target.count : Math.ceil(target.count / 2);
    state.cursorStack = { ...target, count };
    state.cursorOrigin = originFor(command.slot, station);
    write(state, command.slot, count === target.count ? null : { ...target, count: target.count - count });
    return;
  }
  if (!target || sameItemStackIdentity(target, state.cursorStack)) {
    const moved = put(content, state, command.slot, command.button === 0 ? state.cursorStack.count : 1);
    if (!moved) throw new Error('destination-full');
    return;
  }
  assertCanPlace(content, state, command.slot, state.cursorStack);
  const previous = state.cursorStack;
  write(state, command.slot, previous);
  state.cursorStack = target;
  state.cursorOrigin = originFor(command.slot, station);
}

function distribute(
  content: GameplayContent,
  state: MutableState,
  command: Extract<InventoryPointerCommand, { kind: 'distribute' }>,
): void {
  if (!state.cursorStack) throw new Error('cursor-empty');
  const unique: InventoryPointerSlotRef[] = [];
  const seen = new Set<string>();
  for (const ref of command.targets) {
    const key = `${ref.kind}:${ref.slot}`;
    if (seen.has(key)) continue;
    seen.add(key);
    current(state, ref);
    assertCanPlace(content, state, ref, state.cursorStack);
    const target = current(state, ref);
    if (target && !sameItemStackIdentity(target, state.cursorStack)) throw new Error('destination-occupied');
    unique.push(ref);
  }
  const amount = command.button === 0 ? Math.floor(state.cursorStack.count / unique.length) : 1;
  if (amount < 1) throw new Error('insufficient-items');
  let moved = 0;
  for (const ref of unique) {
    if (!state.cursorStack) break;
    moved += put(content, state, ref, amount);
  }
  if (!moved) throw new Error('destination-full');
}

function destinations(
  actor: InventoryPointerActorProjectionV1,
  station: MutableState['station'],
  source: InventoryPointerSlotRef,
): InventoryPointerSlotRef[] {
  if (station) {
    if (source.kind === 'station') return actor.slots.map((_, slot) => ({ kind: 'inventory' as const, slot }));
    return stationSlots(station).map((_, slot) => ({ kind: 'station' as const, slot }));
  }
  if (source.kind !== 'inventory') throw new Error('station-context-required');
  const start = source.slot < actor.equipment.hotbarSize ? actor.equipment.hotbarSize : 0;
  const end = source.slot < actor.equipment.hotbarSize ? actor.slots.length : actor.equipment.hotbarSize;
  return Array.from({ length: end - start }, (_, offset) => ({ kind: 'inventory' as const, slot: start + offset }));
}

function quickMove(
  content: GameplayContent,
  actor: InventoryPointerActorProjectionV1,
  state: MutableState,
  command: Extract<InventoryPointerCommand, { kind: 'quick-move' }>,
): void {
  if (state.cursorStack) throw new Error('cursor-not-empty');
  let source = current(state, command.slot);
  if (!source) throw new Error('empty-source-slot');
  const targets = destinations(actor, state.station, command.slot);
  let moved = 0;
  for (const emptyPass of [false, true]) {
    for (const ref of targets) {
      if (!source) break;
      if (ref.kind === command.slot.kind && ref.slot === command.slot.slot) continue;
      if (ref.kind === 'station' && !canPlaceStation(content, state.station!, ref.slot, source)) continue;
      const target = current(state, ref);
      if ((emptyPass && target) || (!emptyPass && (!target || !sameItemStackIdentity(target, source)))) continue;
      const count = Math.min(source.count, Math.max(0, capacity(content.items, target, source)));
      if (!count) continue;
      write(state, ref, { ...source, count: (target?.count ?? 0) + count });
      source = source.count === count ? null : { ...source, count: source.count - count };
      moved += count;
    }
  }
  if (!moved) throw new Error('destination-full');
  write(state, command.slot, source);
}

function collect(
  content: GameplayContent,
  state: MutableState,
  command: Extract<InventoryPointerCommand, { kind: 'collect' }>,
): void {
  const cursor = state.cursorStack;
  if (!cursor) throw new Error('cursor-empty');
  const seed = current(state, command.slot);
  if (seed && !sameItemStackIdentity(seed, cursor)) throw new Error('collect-identity-mismatch');
  let count = cursor.count;
  const limit = content.items.require(cursor.itemId).stackLimit;
  const refs: InventoryPointerSlotRef[] = [
    ...state.slots.map((_, slot) => ({ kind: 'inventory' as const, slot })),
    ...(state.stationSlots?.map((_, slot) => ({ kind: 'station' as const, slot })) ?? []),
  ];
  for (const ref of refs) {
    if (count >= limit) break;
    const stack = current(state, ref);
    if (!stack || !sameItemStackIdentity(stack, cursor)) continue;
    const taken = Math.min(stack.count, limit - count);
    count += taken;
    write(state, ref, stack.count === taken ? null : { ...stack, count: stack.count - taken });
  }
  if (count === cursor.count) throw new Error('no-collectable-items');
  state.cursorStack = { ...cursor, count };
}

function hotbar(
  content: GameplayContent,
  state: MutableState,
  command: Extract<InventoryPointerCommand, { kind: 'hotbar' }>,
): void {
  if (state.cursorStack) throw new Error('cursor-not-empty');
  if (command.hotbarSlot >= state.slots.length) throw new Error('invalid-hotbar-slot');
  const hotbarRef = { kind: 'inventory' as const, slot: command.hotbarSlot };
  if (command.slot.kind === 'inventory' && command.slot.slot === command.hotbarSlot) throw new Error('same-slot');
  const source = current(state, command.slot);
  const target = current(state, hotbarRef);
  if (target && command.slot.kind === 'station') assertCanPlace(content, state, command.slot, target);
  if (command.slot.kind === 'station' && state.station?.kind === 'furnace' && command.slot.slot === 2 && target)
    throw new Error('furnace-output-is-read-only');
  write(state, command.slot, target);
  write(state, hotbarRef, source);
}

function matchingRecipe(content: GameplayContent, grid: readonly InventorySlot[]) {
  if (!content.stations) throw new Error('station-content-unavailable');
  return content.stations
    .listRecipes()
    .find((recipe) =>
      recipe.kind === 'shaped'
        ? matchesShapedStationRecipe(grid, recipe, content.items)
        : matchesShapelessStationRecipe(grid, recipe, content.items),
    );
}

function craft(
  content: GameplayContent,
  state: MutableState,
  command: Extract<InventoryPointerCommand, { kind: 'craft' }>,
): void {
  if (!state.station || state.station.kind !== 'workbench' || !state.stationSlots)
    throw new Error('station-is-not-workbench');
  if (
    !command.batch &&
    state.cursorStack &&
    state.cursorStack.count >= content.items.require(state.cursorStack.itemId).stackLimit
  )
    throw new Error('cursor-full');
  let grid = state.stationSlots;
  let output = command.batch ? state.slots : [state.cursorStack];
  let crafted = 0;
  for (let attempt = 0; attempt < 1024; attempt += 1) {
    const recipe = matchingRecipe(content, grid);
    if (!recipe) break;
    const result = createStationCraftCandidate({ items: content.items, recipe, grid, output });
    if (!result.success) {
      if (!crafted) throw new Error(result.reason);
      break;
    }
    grid = result.grid;
    output = result.output;
    crafted += 1;
    if (!command.batch) break;
  }
  if (!crafted) throw new Error('recipe-mismatch');
  state.stationSlots = grid;
  if (command.batch) state.slots = output;
  else {
    if (output.length !== 1 || !output[0]) throw new Error('unsupported-craft-output');
    state.cursorStack = output[0];
  }
  state.crafted = crafted;
}

function close(
  content: GameplayContent,
  state: MutableState,
  station: InventoryPointerStationProjectionV1 | undefined,
): void {
  if (!state.cursorStack) return;
  const origin = state.cursorOrigin;
  if (origin?.kind === 'inventory' && origin.slot < state.slots.length) {
    const target = state.slots[origin.slot];
    if (!target || sameItemStackIdentity(target, state.cursorStack))
      put(content, state, { kind: 'inventory', slot: origin.slot }, state.cursorStack.count);
  } else if (
    origin?.kind === 'station' &&
    station &&
    same(origin.reference, station.reference) &&
    state.stationSlots &&
    origin.slot < state.stationSlots.length
  ) {
    const target = state.stationSlots[origin.slot];
    if (!target || sameItemStackIdentity(target, state.cursorStack)) {
      // Exact-origin settlement is allowed for a furnace output that was just taken.
      const count = Math.min(state.cursorStack.count, capacity(content.items, target, state.cursorStack));
      if (count > 0) {
        write(
          state,
          { kind: 'station', slot: origin.slot },
          { ...state.cursorStack, count: (target?.count ?? 0) + count },
        );
        state.cursorStack =
          state.cursorStack.count === count ? null : { ...state.cursorStack, count: state.cursorStack.count - count };
        if (!state.cursorStack) state.cursorOrigin = null;
      }
    }
  }
  if (state.cursorStack) {
    const settled = settleInventoryCursor(content.items, state.slots, {
      version: 1,
      revision: 0,
      stack: state.cursorStack,
      origin: state.cursorOrigin,
    });
    state.slots = [...settled.slots];
    state.drops.push(...settled.dropIntents.map((stack) => ({ ...stack })));
    state.cursorStack = null;
    state.cursorOrigin = null;
  }
}

function finalizeStation(
  content: GameplayContent,
  previous: StationComponentV1,
  values: InventorySlot[],
): StationComponentV1 {
  if (same(stationSlots(previous), values)) return previous;
  let next: StationComponentV1;
  if (previous.kind === 'workbench') next = { ...previous, revision: previous.revision + 1, grid: values };
  else if (previous.kind === 'chest') next = { ...previous, revision: previous.revision + 1, slots: values };
  else {
    const furnace = { ...previous.furnace, input: values[0]!, fuel: values[1]!, output: values[2]! };
    const active = furnace.activeRecipeId ? content.stations!.codec.furnace.recipe(furnace.activeRecipeId) : undefined;
    if (
      active &&
      (!furnace.input ||
        !sameItemStackIdentity(furnace.input, active.input) ||
        furnace.input.count < active.input.count)
    ) {
      furnace.activeRecipeId = null;
      furnace.progressSeconds = 0;
    }
    next = { ...previous, revision: previous.revision + 1, furnace };
  }
  if (next.revision > Number.MAX_SAFE_INTEGER) throw new RangeError('Station revision exhausted.');
  return content.stations!.codec.decode(next, previous.entityId);
}

/** Pure candidate builder. Registered owners recompute this value at the commit frontier. */
export function buildInventoryPointerCandidate(
  content: GameplayContent,
  request: Readonly<{
    actor: InventoryPointerActorProjectionV1;
    station?: InventoryPointerStationProjectionV1;
    input: unknown;
  }>,
): InventoryPointerCandidateV1 {
  const input = validateInventoryPointerInput(request.input);
  const actor = request.actor;
  if (actor.lifecycle !== 'alive') throw new Error('actor-dead');
  if (!same(input.actor, actor.reference)) throw new Error('stale-actor-reference');
  if (input.expectedInventoryRevision !== actor.inventoryRevision) throw new Error('stale-inventory-revision');
  if (!integer(actor.inventoryRevision) || actor.inventoryRevision >= Number.MAX_SAFE_INTEGER)
    throw new RangeError('Inventory revision exhausted.');
  const cursor = validateInventoryCursor(actor.cursor, content.items);
  const station = request.station;
  if (Boolean(input.station) !== Boolean(station)) throw new Error('station-context-mismatch');
  if (station) {
    if (!content.stations || !same(input.station!.reference, station.reference))
      throw new Error('stale-station-reference');
    if (input.station!.expectedRevision !== station.component.revision) throw new Error('stale-station-revision');
    if (station.component.revision >= Number.MAX_SAFE_INTEGER) throw new RangeError('Station revision exhausted.');
  }
  const usesStation =
    input.command.kind === 'craft' ||
    ('slot' in input.command && input.command.slot.kind === 'station') ||
    (input.command.kind === 'distribute' && input.command.targets.some((target) => target.kind === 'station'));
  if (usesStation && !station) throw new Error('station-context-required');
  const state: MutableState = {
    slots: new Inventory(actor.slots.length, actor.slots, content.items).snapshot(),
    cursorStack: cursor.stack
      ? { ...cursor.stack, ...(cursor.stack.instance ? { instance: { ...cursor.stack.instance } } : {}) }
      : null,
    cursorOrigin: cursor.origin,
    station: station?.component ?? null,
    stationSlots: station ? stationSlots(station.component) : null,
    drops: [],
    crafted: 0,
  };
  const before = JSON.stringify([state.slots, state.cursorStack, state.cursorOrigin, state.stationSlots]);
  switch (input.command.kind) {
    case 'click':
      click(content, state, station, input.command);
      break;
    case 'distribute':
      distribute(content, state, input.command);
      break;
    case 'quick-move':
      quickMove(content, actor, state, input.command);
      break;
    case 'collect':
      collect(content, state, input.command);
      break;
    case 'hotbar':
      hotbar(content, state, input.command);
      break;
    case 'craft':
      craft(content, state, input.command);
      break;
    case 'close':
      close(content, state, station);
      break;
    case 'drop': {
      if (!state.cursorStack) throw new Error('cursor-empty');
      const count = input.command.button === 0 ? state.cursorStack.count : 1;
      state.drops.push({ ...state.cursorStack, count });
      state.cursorStack =
        state.cursorStack.count === count ? null : { ...state.cursorStack, count: state.cursorStack.count - count };
      if (!state.cursorStack) state.cursorOrigin = null;
      break;
    }
  }
  const changed = before !== JSON.stringify([state.slots, state.cursorStack, state.cursorOrigin, state.stationSlots]);
  if (changed && cursor.revision >= Number.MAX_SAFE_INTEGER)
    throw new RangeError('Inventory cursor revision exhausted.');
  const nextStation =
    station && state.stationSlots ? finalizeStation(content, station.component, state.stationSlots) : null;
  const inventoryRevision = actor.inventoryRevision + Number(changed);
  const nextCursor = Object.freeze({
    version: 1 as const,
    revision: cursor.revision + Number(changed),
    stack: frozenStack(state.cursorStack),
    origin: state.cursorStack ? state.cursorOrigin : null,
  });
  const result = Object.freeze({
    version: 1 as const,
    success: true as const,
    kind: 'pointer' as const,
    actorId: actor.reference.entityId,
    inventoryRevision,
    cursorRevision: nextCursor.revision,
    ...(nextStation && nextStation.revision !== station?.component.revision
      ? { stationRevision: nextStation.revision }
      : {}),
    ...(state.crafted ? { crafted: state.crafted } : {}),
  });
  return Object.freeze({
    version: 1,
    kind: 'pointer',
    actorId: actor.reference.entityId,
    actorReference: actor.reference,
    inventoryRevision,
    slots: Object.freeze(state.slots.map(frozenStack)),
    cursor: nextCursor,
    stationReference: station?.reference ?? null,
    station: nextStation,
    dropIntents: Object.freeze(state.drops.map((stack) => frozenStack(stack)!)),
    changed,
    result,
  });
}

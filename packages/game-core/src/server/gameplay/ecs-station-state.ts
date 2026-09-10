import { addComponent, type World } from 'bitecs';
import { cloneItemStack } from './item-instance';
import { Inventory, type InventorySlot } from './inventory';
import type { ItemDefinitionRegistry } from './item-registry';
import { validateFurnaceSnapshot, type FurnaceDefinitions, type FurnaceSnapshotV1 } from './modules/furnace-candidates';

export type StationKind = 'workbench' | 'chest' | 'furnace';
export type StationDefinition = Readonly<{ kind: StationKind; voxel: number }>;

type StationComponentBase = Readonly<{
  version: 1;
  entityId: string;
  revision: number;
  kind: StationKind;
  voxel: number;
}>;

export type WorkbenchStationComponentV1 = StationComponentBase &
  Readonly<{ kind: 'workbench'; grid: readonly InventorySlot[] }>;
export type ChestStationComponentV1 = StationComponentBase &
  Readonly<{ kind: 'chest'; slots: readonly InventorySlot[] }>;
export type FurnaceStationComponentV1 = StationComponentBase &
  Readonly<{ kind: 'furnace'; furnace: FurnaceSnapshotV1 }>;
export type StationComponentV1 = WorkbenchStationComponentV1 | ChestStationComponentV1 | FurnaceStationComponentV1;

export type StationStateCodec = Readonly<{
  items: ItemDefinitionRegistry;
  furnace: FurnaceDefinitions;
  definitions: readonly StationDefinition[];
  definition(kind: StationKind): StationDefinition | undefined;
  kindForVoxel(voxel: number): StationKind | undefined;
  create(entityId: string, kind: StationKind): StationComponentV1;
  decode(raw: unknown, expectedEntityId?: string): StationComponentV1;
}>;

export type StationStateCodecInput = Readonly<{
  items: ItemDefinitionRegistry;
  furnace: FurnaceDefinitions;
  definitions: readonly StationDefinition[];
}>;

type StationEntityInput = Readonly<{
  position: readonly number[];
  station?: Readonly<{ kind: StationKind }>;
  physicsVelocity?: unknown;
  stack?: unknown;
  health?: unknown;
  maxHealth?: unknown;
  archetype?: unknown;
  persistent?: unknown;
}>;

type SlotArray<Value> = Array<Value | undefined>;
export type StationComponents = ReturnType<typeof createStationComponents>;
export type PreparedStationComponentSnapshot = StationComponentV1;

export const createStationComponents = () => ({ station: { value: [] as SlotArray<StationComponentV1> } });

export function createStationStateCodec(input: StationStateCodecInput): StationStateCodec {
  if (!input || typeof input !== 'object' || input.furnace?.items !== input.items)
    throw new TypeError('Station and furnace item registries must be the same world registry.');
  if (!Array.isArray(input.definitions) || input.definitions.length === 0)
    throw new TypeError('Station definitions must be an explicit non-empty array.');

  const byKind = new Map<StationKind, StationDefinition>();
  const byVoxel = new Map<number, StationKind>();
  for (const source of input.definitions) {
    if (!source || !isStationKind(source.kind)) throw new TypeError('Station definition kind is invalid.');
    if (!Number.isSafeInteger(source.voxel) || source.voxel <= 0)
      throw new TypeError(`Station voxel is invalid: ${String(source.voxel)}`);
    if (byKind.has(source.kind)) throw new TypeError(`Duplicate station kind definition: ${source.kind}`);
    if (byVoxel.has(source.voxel)) throw new TypeError(`Duplicate station voxel definition: ${source.voxel}`);
    const definition = Object.freeze({ kind: source.kind, voxel: source.voxel });
    byKind.set(definition.kind, definition);
    byVoxel.set(definition.voxel, definition.kind);
  }
  const definitions = Object.freeze([...byKind.values()]);

  const codec: StationStateCodec = Object.freeze({
    items: input.items,
    furnace: input.furnace,
    definitions,
    definition: (kind) => byKind.get(kind),
    kindForVoxel: (voxel) => byVoxel.get(voxel),
    create: (entityId, kind) => {
      assertEntityId(entityId);
      const definition = byKind.get(kind);
      if (!definition) throw new TypeError(`Unknown station kind: ${String(kind)}`);
      const base = { version: 1 as const, entityId, revision: 0, kind, voxel: definition.voxel };
      if (kind === 'workbench') return freezeStation({ ...base, kind, grid: emptySlots(9) });
      if (kind === 'chest') return freezeStation({ ...base, kind, slots: emptySlots(24) });
      return freezeStation({
        ...base,
        kind,
        furnace: validateFurnaceSnapshot(
          {
            version: 1,
            input: null,
            fuel: null,
            output: null,
            activeRecipeId: null,
            remainingFuelSeconds: 0,
            progressSeconds: 0,
          },
          input.furnace,
        ),
      });
    },
    decode: (raw, expectedEntityId) => decodeStation(raw, expectedEntityId, byKind, input),
  });
  return codec;
}

export function validateStationEntityInput(input: StationEntityInput, codec: StationStateCodec | undefined): void {
  if (!input.station || !codec) throw new TypeError('Station creation requires a configured station codec.');
  if (!input.position.every(Number.isSafeInteger))
    throw new TypeError('Station position must contain three safe integers.');
  if (
    input.physicsVelocity !== undefined ||
    input.stack !== undefined ||
    input.health !== undefined ||
    input.maxHealth !== undefined ||
    input.archetype !== undefined ||
    input.persistent !== undefined
  )
    throw new TypeError('Station entities cannot own dynamic actor or world-item fields.');
  if (!codec.definition(input.station.kind)) throw new TypeError(`Unknown station kind: ${String(input.station.kind)}`);
}

export function collectStationSnapshots(raw: readonly unknown[]): Map<string, StationComponentV1> {
  const snapshots = new Map<string, StationComponentV1>();
  for (const station of raw) {
    const candidate = station as Partial<StationComponentV1> | null;
    if (
      !candidate ||
      typeof candidate !== 'object' ||
      typeof candidate.entityId !== 'string' ||
      !candidate.entityId.trim() ||
      snapshots.has(candidate.entityId)
    )
      throw new TypeError('Station component snapshots are invalid or duplicated.');
    snapshots.set(candidate.entityId, candidate as StationComponentV1);
  }
  return snapshots;
}

export function initializeStationComponent(
  world: World,
  components: StationComponents,
  eid: number,
  prepared: PreparedStationComponentSnapshot,
): void {
  addComponent(world, eid, components.station);
  components.station.value[eid] = prepared;
}

export function clearStationComponent(components: StationComponents, eid: number): void {
  delete components.station.value[eid];
}

export function readStationComponentSnapshot(components: StationComponents, eid: number): StationComponentV1 {
  const snapshot = components.station.value[eid];
  if (!snapshot) throw new TypeError('Station component is missing.');
  return snapshot;
}

export function prepareStationComponentSnapshot(
  codec: StationStateCodec,
  snapshot: unknown,
  expectedEntityId: string,
): PreparedStationComponentSnapshot {
  return codec.decode(snapshot, expectedEntityId);
}

export function installPreparedStationComponentSnapshot(
  components: StationComponents,
  eid: number,
  prepared: PreparedStationComponentSnapshot,
): void {
  components.station.value[eid] = prepared;
}

/** Keeps station component storage and its optional per-world codec behind one bounded owner. */
export class EcsStationStateOwner {
  readonly components = createStationComponents();

  constructor(
    private readonly world: World,
    private readonly codec: StationStateCodec | undefined,
    items: ItemDefinitionRegistry,
  ) {
    if (codec && codec.items !== items)
      throw new TypeError('Entity owner and station codec item registries must match.');
  }

  componentValues(): object[] {
    return Object.values(this.components);
  }

  create(entityId: string, kind: StationKind): StationComponentV1 {
    return this.requireCodec().create(entityId, kind);
  }

  prepare(entityType: string, entityId: string, snapshot: unknown): PreparedStationComponentSnapshot {
    if (entityType !== 'station') throw new TypeError('Station component requires a station entity.');
    return prepareStationComponentSnapshot(this.requireCodec(), snapshot, entityId);
  }

  initialize(eid: number, prepared: PreparedStationComponentSnapshot): void {
    initializeStationComponent(this.world, this.components, eid, prepared);
  }

  snapshot(eid: number): StationComponentV1 {
    return readStationComponentSnapshot(this.components, eid);
  }

  replace(eid: number, prepared: PreparedStationComponentSnapshot): void {
    installPreparedStationComponentSnapshot(this.components, eid, prepared);
  }

  clear(eid: number): void {
    clearStationComponent(this.components, eid);
  }

  assertPosition(position: readonly number[]): void {
    if (position.length !== 3 || !position.every(Number.isSafeInteger))
      throw new TypeError('Station position must contain three safe integers.');
  }

  at<Entity extends Readonly<{ position: readonly number[] }>>(
    entities: readonly Entity[],
    position: readonly number[],
  ): Entity | null {
    if (position.length !== 3 || !position.every(Number.isSafeInteger)) return null;
    return (
      entities.find(
        (entity) =>
          entity.position[0] === position[0] &&
          entity.position[1] === position[1] &&
          entity.position[2] === position[2],
      ) ?? null
    );
  }

  private requireCodec(): StationStateCodec {
    if (!this.codec) throw new TypeError('Station codec is not configured for this entity world.');
    return this.codec;
  }
}

function decodeStation(
  raw: unknown,
  expectedEntityId: string | undefined,
  byKind: ReadonlyMap<StationKind, StationDefinition>,
  input: StationStateCodecInput,
): StationComponentV1 {
  const source = raw as Partial<StationComponentV1> | null;
  if (!source || typeof source !== 'object' || Array.isArray(source) || source.version !== 1)
    throw new TypeError('Station component version is invalid.');
  assertEntityId(source.entityId);
  if (expectedEntityId !== undefined && source.entityId !== expectedEntityId)
    throw new TypeError('Station component identity does not match its entity.');
  const revision = source.revision;
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0)
    throw new TypeError('Station component revision is invalid.');
  if (!isStationKind(source.kind)) throw new TypeError('Station component kind is invalid.');
  const definition = byKind.get(source.kind);
  if (!definition || source.voxel !== definition.voxel)
    throw new TypeError('Station component voxel does not match its kind definition.');

  const base = {
    version: 1 as const,
    entityId: source.entityId,
    revision,
    kind: source.kind,
    voxel: definition.voxel,
  };
  if (source.kind === 'workbench') {
    assertExactKeys(source, ['version', 'entityId', 'revision', 'kind', 'voxel', 'grid']);
    return freezeStation({
      ...base,
      kind: 'workbench',
      grid: validateSlots((source as Partial<WorkbenchStationComponentV1>).grid, 9, input.items, 'grid'),
    });
  }
  if (source.kind === 'chest') {
    assertExactKeys(source, ['version', 'entityId', 'revision', 'kind', 'voxel', 'slots']);
    return freezeStation({
      ...base,
      kind: 'chest',
      slots: validateSlots((source as Partial<ChestStationComponentV1>).slots, 24, input.items, 'slots'),
    });
  }
  assertExactKeys(source, ['version', 'entityId', 'revision', 'kind', 'voxel', 'furnace']);
  return freezeStation({
    ...base,
    kind: 'furnace',
    furnace: validateFurnaceSnapshot((source as Partial<FurnaceStationComponentV1>).furnace, input.furnace),
  });
}

function validateSlots(
  raw: unknown,
  capacity: number,
  items: ItemDefinitionRegistry,
  label: string,
): readonly InventorySlot[] {
  if (!Array.isArray(raw) || raw.length !== capacity)
    throw new TypeError(`Station ${label} must contain ${capacity} slots.`);
  assertDense(raw, `Station ${label}`);
  try {
    return freezeSlots(new Inventory(capacity, raw as InventorySlot[], items).snapshot());
  } catch (error) {
    throw new TypeError(`Station ${label} is invalid: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
}

function freezeStation(snapshot: StationComponentV1): StationComponentV1 {
  if (snapshot.kind === 'workbench') return Object.freeze({ ...snapshot, grid: freezeSlots(snapshot.grid) });
  if (snapshot.kind === 'chest') return Object.freeze({ ...snapshot, slots: freezeSlots(snapshot.slots) });
  const furnace = snapshot.furnace;
  return Object.freeze({
    ...snapshot,
    furnace: Object.freeze({
      ...furnace,
      input: freezeSlot(furnace.input),
      fuel: freezeSlot(furnace.fuel),
      output: freezeSlot(furnace.output),
    }),
  });
}

const emptySlots = (capacity: number): readonly InventorySlot[] =>
  Object.freeze(Array.from({ length: capacity }, () => null));
const freezeSlots = (slots: readonly InventorySlot[]): readonly InventorySlot[] =>
  Object.freeze(slots.map((slot) => freezeSlot(slot)));
const freezeSlot = (slot: InventorySlot): InventorySlot => {
  if (slot === null) return null;
  const copy = cloneItemStack(slot);
  if (copy.instance) Object.freeze(copy.instance);
  return Object.freeze(copy);
};

const isStationKind = (value: unknown): value is StationKind =>
  value === 'workbench' || value === 'chest' || value === 'furnace';

function assertEntityId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError('Station entity identity is invalid.');
}

function assertDense(entries: readonly unknown[], label: string): void {
  for (let index = 0; index < entries.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(entries, index);
    if (!descriptor || !('value' in descriptor)) throw new TypeError(`${label} must be dense data.`);
  }
}

function assertExactKeys(value: object, expected: readonly string[]): void {
  const keys = Object.keys(value).sort();
  const allowed = [...expected].sort();
  if (keys.length !== allowed.length || keys.some((key, index) => key !== allowed[index]))
    throw new TypeError('Station component shape is invalid for its kind.');
}

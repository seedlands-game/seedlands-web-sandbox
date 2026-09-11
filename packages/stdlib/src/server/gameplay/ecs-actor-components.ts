import type { Inventory, InventoryAccess } from './inventory';
import type { ItemId } from './item-registry';
import type { BreakAction, PlayerSnapshot } from './player-state';
import type { InventoryCursorV1 } from './modules/inventory-pointer-contract';
import type { CharacterComponentStateV1 } from '../simulation/character-runtime-types';

export type ActorMode = 'survival' | 'creative';
export type ActorModeComponentV1 = Readonly<{ version: 1; value: ActorMode; revision: number }>;
export type CreativeCatalogComponentV1 = Readonly<{
  version: 1;
  hotbar: readonly (ItemId | null)[];
  selectedSlot: number;
  revision: number;
}>;
export type ActorFlightComponentV1 = Readonly<{ version: 1; enabled: boolean; revision: number }>;
export type ActorModeSnapshotFacets = Readonly<{
  mode?: ActorModeComponentV1;
  creativeCatalog?: CreativeCatalogComponentV1;
  flight?: ActorFlightComponentV1;
}>;

export type ActorNeeds = {
  hunger: number;
  maxHunger: number;
  hungerMeaning: 'satiety' | 'deficit';
  hungerAccumulator: number;
  healingAccumulator: number;
  starvationAccumulator: number;
};

export type ActorComponentAccess = {
  health: number;
  readonly maxHealth: number;
  lifecycle: PlayerSnapshot['lifecycle'];
  hunger: number;
  readonly maxHunger: number;
  readonly hungerMeaning: ActorNeeds['hungerMeaning'];
  selectedSlot: number;
  readonly hotbarSize: number;
  readonly inventory: InventoryAccess;
  readonly inventoryRevision: number;
  readonly inventoryCursor: InventoryCursorV1;
  readonly controlSource: ActorControlSource;
  readonly controlRevision: number;
  readonly mode: ActorMode;
  readonly modeRevision: number;
  readonly creativeCatalog: CreativeCatalogComponentV1;
  readonly flight: ActorFlightComponentV1;
  selectSlot: (slot: number) => boolean;
  replaceModeComponents: (facets: ActorModeSnapshotFacets) => void;
  replaceInventoryInteraction: (revision: number, cursor: InventoryCursorV1) => void;
  replaceControl: (source: ActorControlSource, expectedRevision?: number) => number;
};

export type PlayerComponentAccess = ActorComponentAccess &
  Pick<
    PlayerSnapshot,
    'spawnPosition' | 'hungerAccumulator' | 'healingAccumulator' | 'starvationAccumulator' | 'breakAction'
  >;

export type ActorControlSource = 'player' | 'autonomous' | 'behavior' | 'none';

/** Every owner constructs these stores; none of the component references are shared between worlds. */
export const createActorComponents = () => ({
  needs: {
    hunger: [] as number[],
    maxHunger: [] as number[],
    hungerMeaning: [] as ActorNeeds['hungerMeaning'][],
    hungerAccumulator: [] as number[],
    healingAccumulator: [] as number[],
    starvationAccumulator: [] as number[],
  },
  inventory: {
    value: [] as (Inventory | undefined)[],
    revision: [] as number[],
    cursor: [] as (InventoryCursorV1 | undefined)[],
  },
  equipment: { selectedSlot: [] as number[], hotbarSize: [] as number[] },
  control: { source: [] as (ActorControlSource | undefined)[], revision: [] as number[] },
  behavior: { value: [] as (CharacterComponentStateV1 | undefined)[] },
  life: { lifecycle: [] as PlayerSnapshot['lifecycle'][] },
  mode: { value: [] as (ActorMode | undefined)[], revision: [] as number[] },
  creativeCatalog: {
    hotbar: [] as (readonly (ItemId | null)[] | undefined)[],
    selectedSlot: [] as number[],
    revision: [] as number[],
  },
  flight: { enabled: [] as boolean[], revision: [] as number[] },
  player: {
    spawnX: [] as number[],
    spawnY: [] as number[],
    spawnZ: [] as number[],
    breakAction: [] as (BreakAction | null | undefined)[],
  },
});

export type ActorComponentSnapshot = Readonly<{
  entityId: string;
  needs: ActorNeeds;
  inventory: import('./inventory').InventorySlot[];
  /** Added after the original V4 snapshot; omitted snapshots migrate to zero and an empty cursor. */
  inventoryRevision?: number;
  inventoryCursor?: InventoryCursorV1;
  equipment: Readonly<{ selectedSlot: number; hotbarSize: number }>;
  lifecycle: PlayerSnapshot['lifecycle'];
  controlSource: ActorControlSource;
  /** Added with behavior control; omitted snapshots migrate to revision zero. */
  controlRevision?: number;
  /** Optional behavior state owned by the same ECS actor snapshot frontier. */
  character?: CharacterComponentStateV1;
  mode?: ActorModeComponentV1;
  creativeCatalog?: CreativeCatalogComponentV1;
  flight?: ActorFlightComponentV1;
  player?: Readonly<{
    spawnPosition: [number, number, number];
    breakAction: BreakAction | null;
  }>;
}>;

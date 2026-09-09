import type { Inventory, InventoryAccess } from './inventory';
import type { BreakAction, PlayerSnapshot } from './player-state';

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
  readonly controlSource: ActorControlSource;
  selectSlot: (slot: number) => boolean;
};

export type PlayerComponentAccess = ActorComponentAccess &
  Pick<
    PlayerSnapshot,
    'spawnPosition' | 'hungerAccumulator' | 'healingAccumulator' | 'starvationAccumulator' | 'breakAction'
  >;

export type ActorControlSource = 'player' | 'autonomous' | 'none';

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
  inventory: { value: [] as (Inventory | undefined)[] },
  equipment: { selectedSlot: [] as number[], hotbarSize: [] as number[] },
  control: { source: [] as (ActorControlSource | undefined)[] },
  life: { lifecycle: [] as PlayerSnapshot['lifecycle'][] },
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
  equipment: Readonly<{ selectedSlot: number; hotbarSize: number }>;
  lifecycle: PlayerSnapshot['lifecycle'];
  controlSource: ActorControlSource;
  player?: Readonly<{
    spawnPosition: [number, number, number];
    breakAction: BreakAction | null;
  }>;
}>;

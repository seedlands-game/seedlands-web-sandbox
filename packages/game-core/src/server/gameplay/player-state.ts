import type { InventoryAccess, InventorySlot } from './inventory';
import { EntityStore } from './entity-store';
import type { PlayerComponentAccess } from './ecs-actor-components';
import type { CombatSnapshot } from './combat-runtime';

export type PlayerLifecycle = 'alive' | 'dead';
export type BreakAction = {
  position: [number, number, number];
  voxel: number;
  elapsedSeconds: number;
  requiredSeconds: number;
};

export type PlayerSnapshot = {
  entityId: string;
  spawnPosition: [number, number, number];
  health: number;
  maxHealth: 20;
  hunger: number;
  maxHunger: 20;
  lifecycle: PlayerLifecycle;
  inventory: InventorySlot[];
  selectedSlot: number;
  hotbarSize: 8;
  attackCooldownSeconds: number;
  hungerAccumulator: number;
  healingAccumulator: number;
  starvationAccumulator: number;
  breakAction: BreakAction | null;
  /** Optional in the type only so legacy snapshots and fixtures remain readable. Runtime views always provide it. */
  combat?: CombatSnapshot;
};

export class PlayerState {
  private readonly state: PlayerComponentAccess;
  readonly maxHealth = 20 as const;
  readonly maxHunger = 20 as const;
  readonly hotbarSize = 8 as const;

  constructor(
    readonly entityId: string,
    spawnPosition: [number, number, number],
    snapshot?: Partial<PlayerSnapshot>,
    entities?: EntityStore,
  ) {
    if (!entityId.trim() || spawnPosition.length !== 3 || !spawnPosition.every(Number.isFinite))
      throw new TypeError('Player state identity or spawn position is invalid.');
    const owner = entities ?? new EntityStore();
    if (!entities) owner.spawn({ id: entityId, type: 'player', position: spawnPosition });
    this.state = owner.playerStateAccess(entityId);
    this.state.spawnPosition = [...spawnPosition];
    if (snapshot?.inventory) this.inventory.replace(snapshot.inventory);
    if (snapshot) this.restoreFields(snapshot);
  }

  get inventory(): InventoryAccess {
    return this.state.inventory;
  }

  get spawnPosition(): [number, number, number] {
    return this.state.spawnPosition;
  }

  get health(): number {
    return this.state.health;
  }

  set health(value: number) {
    this.state.health = value;
  }

  get hunger(): number {
    return this.state.hunger;
  }

  set hunger(value: number) {
    this.state.hunger = value;
  }

  get lifecycle(): PlayerLifecycle {
    return this.state.lifecycle;
  }

  set lifecycle(value: PlayerLifecycle) {
    this.state.lifecycle = value;
  }

  get selectedSlot(): number {
    return this.state.selectedSlot;
  }

  set selectedSlot(value: number) {
    this.state.selectedSlot = value;
  }

  get hungerAccumulator(): number {
    return this.state.hungerAccumulator;
  }

  set hungerAccumulator(value: number) {
    this.state.hungerAccumulator = value;
  }

  get healingAccumulator(): number {
    return this.state.healingAccumulator;
  }

  set healingAccumulator(value: number) {
    this.state.healingAccumulator = value;
  }

  get starvationAccumulator(): number {
    return this.state.starvationAccumulator;
  }

  set starvationAccumulator(value: number) {
    this.state.starvationAccumulator = value;
  }

  get breakAction(): BreakAction | null {
    return this.state.breakAction;
  }

  set breakAction(value: BreakAction | null) {
    this.state.breakAction = value;
  }

  selectSlot(slot: number): boolean {
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.hotbarSize) return false;
    this.selectedSlot = slot;
    return true;
  }

  snapshot(combat?: CombatSnapshot): PlayerSnapshot {
    return {
      entityId: this.entityId,
      spawnPosition: [...this.spawnPosition],
      health: this.health,
      maxHealth: this.maxHealth,
      hunger: this.hunger,
      maxHunger: this.maxHunger,
      lifecycle: this.lifecycle,
      inventory: this.inventory.snapshot(),
      selectedSlot: this.selectedSlot,
      hotbarSize: this.hotbarSize,
      attackCooldownSeconds: combat?.cooldownRemainingSeconds ?? 0,
      hungerAccumulator: this.hungerAccumulator,
      healingAccumulator: this.healingAccumulator,
      starvationAccumulator: this.starvationAccumulator,
      breakAction: this.breakAction ? { ...this.breakAction, position: [...this.breakAction.position] } : null,
      ...(combat ? { combat } : {}),
    };
  }

  respawn(): void {
    this.health = this.maxHealth;
    this.hunger = this.maxHunger;
    this.lifecycle = 'alive';
    this.breakAction = null;
    this.hungerAccumulator = this.healingAccumulator = this.starvationAccumulator = 0;
  }

  private restoreFields(snapshot: Partial<PlayerSnapshot>): void {
    const numeric = [snapshot.health, snapshot.hunger, snapshot.selectedSlot, snapshot.attackCooldownSeconds].filter(
      (value) => value !== undefined,
    );
    if (numeric.some((value) => !Number.isFinite(value)))
      throw new TypeError('Player snapshot contains invalid numbers.');
    if (snapshot.health !== undefined && (snapshot.health < 0 || snapshot.health > 20))
      throw new TypeError('Player snapshot health is invalid.');
    if (snapshot.hunger !== undefined && (snapshot.hunger < 0 || snapshot.hunger > 20))
      throw new TypeError('Player snapshot hunger is invalid.');
    if (snapshot.lifecycle && snapshot.lifecycle !== 'alive' && snapshot.lifecycle !== 'dead')
      throw new TypeError('Player snapshot lifecycle is invalid.');
    if (snapshot.selectedSlot !== undefined && !this.selectSlot(snapshot.selectedSlot))
      throw new TypeError('Player snapshot selected slot is invalid.');
    this.health = snapshot.health ?? this.health;
    this.hunger = snapshot.hunger ?? this.hunger;
    this.lifecycle = snapshot.lifecycle ?? this.lifecycle;
    this.hungerAccumulator = snapshot.hungerAccumulator ?? 0;
    this.healingAccumulator = snapshot.healingAccumulator ?? 0;
    this.starvationAccumulator = snapshot.starvationAccumulator ?? 0;
    this.breakAction = snapshot.breakAction
      ? { ...snapshot.breakAction, position: [...snapshot.breakAction.position] }
      : null;
  }
}

export const createPlayerState = (entityId: string, spawnPosition: [number, number, number]) =>
  new PlayerState(entityId, [...spawnPosition]);

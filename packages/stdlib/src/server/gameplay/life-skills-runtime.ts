import type { EntityStore, GameplayEntity } from './entity-store';
import { Inventory } from './inventory';
import { Voxel } from '../../world/voxel';

type Position = readonly [number, number, number];
export type FishingState = Readonly<{
  playerId: string;
  hook: Position;
  remainingSeconds: number;
  ready: boolean;
  sequence: number;
}>;
export type LifeSkillsCheckpoint = Readonly<{
  version: 1;
  fishingSequence: number;
  eggSequence: number;
  fishing: readonly FishingState[];
}>;
type Context = Readonly<{
  seed: number;
  entities: EntityStore;
  getLoadedVoxel?(position: [number, number, number]): number | undefined;
  spawnChicken(id: string, position: [number, number, number]): GameplayEntity;
  changed(): void;
}>;

const emptyCheckpoint = (): LifeSkillsCheckpoint => ({ version: 1, fishingSequence: 0, eggSequence: 0, fishing: [] });
const distance = (left: readonly number[], right: readonly number[]) =>
  Math.hypot(...left.map((value, axis) => value - right[axis]));
const playerInventory = (context: Context, playerId: string) => {
  const entity = context.entities.get(playerId);
  if (entity?.type !== 'player') return null;
  const actor = context.entities.actorStateAccess(playerId);
  return {
    entity,
    actor,
    inventory: new Inventory(actor.inventory.capacity, actor.inventory.snapshot(), actor.inventory.items),
  };
};

export function validateLifeSkillsCheckpoint(value: LifeSkillsCheckpoint = emptyCheckpoint()): LifeSkillsCheckpoint {
  if (
    value.version !== 1 ||
    ![value.fishingSequence, value.eggSequence].every((number) => Number.isSafeInteger(number) && number >= 0) ||
    !Array.isArray(value.fishing)
  )
    throw new TypeError('Life skills checkpoint is invalid.');
  const ids = new Set<string>();
  const fishing = value.fishing.map((state) => {
    if (
      !state.playerId?.trim() ||
      ids.has(state.playerId) ||
      state.hook.length !== 3 ||
      !state.hook.every(Number.isFinite) ||
      !Number.isFinite(state.remainingSeconds) ||
      state.remainingSeconds < 0 ||
      typeof state.ready !== 'boolean' ||
      !Number.isSafeInteger(state.sequence) ||
      state.sequence < 1 ||
      state.sequence > value.fishingSequence
    )
      throw new TypeError('Fishing checkpoint is invalid.');
    ids.add(state.playerId);
    return Object.freeze({ ...state, hook: Object.freeze([...state.hook] as [number, number, number]) });
  });
  return Object.freeze({ ...value, fishing: Object.freeze(fishing) });
}

export class LifeSkillsRuntime {
  #fishingSequence = 0;
  #eggSequence = 0;
  readonly #fishing = new Map<string, FishingState>();
  constructor(
    private readonly context: Context,
    checkpoint?: LifeSkillsCheckpoint,
  ) {
    this.restore(checkpoint);
  }

  castFishingRod(playerId: string, hook: [number, number, number]) {
    const player = playerInventory(this.context, playerId),
      held = player?.actor.inventory.slot(player.actor.selectedSlot);
    if (!player || held?.itemId !== 'fishing-rod' || !held.instance)
      return { success: false as const, reason: 'requires-fishing-rod' };
    if (this.#fishing.has(playerId)) return { success: false as const, reason: 'already-fishing' };
    if (distance(player.entity.position, hook) > 8 || this.context.getLoadedVoxel?.([...hook]) !== Voxel.Water)
      return { success: false as const, reason: 'invalid-water' };
    const sequence = ++this.#fishingSequence;
    const state = Object.freeze({
      playerId,
      hook: Object.freeze([...hook] as const),
      remainingSeconds: 5 + ((Math.imul(this.context.seed ^ sequence, 0x45d9f3b) >>> 0) % 6),
      ready: false,
      sequence,
    });
    this.#fishing.set(playerId, state);
    this.context.changed();
    return { success: true as const, state };
  }

  advance(seconds: number) {
    if (!Number.isFinite(seconds) || seconds <= 0) throw new TypeError('Life skills advance is invalid.');
    for (const [id, state] of this.#fishing)
      this.#fishing.set(
        id,
        Object.freeze({
          ...state,
          remainingSeconds: Math.max(0, state.remainingSeconds - seconds),
          ready: state.remainingSeconds <= seconds,
        }),
      );
  }

  retrieveFishingRod(playerId: string) {
    const state = this.#fishing.get(playerId),
      player = playerInventory(this.context, playerId);
    if (!state || !player) return { success: false as const, reason: 'not-fishing' };
    if (state.ready && !player.inventory.canAdd({ itemId: 'raw-fish', count: 1 }))
      return { success: false as const, reason: 'inventory-full' };
    if (state.ready) {
      const held = player.inventory.slot(player.actor.selectedSlot);
      if (!held?.instance || held.itemId !== 'fishing-rod') return { success: false as const, reason: 'rod-changed' };
      player.inventory.add({ itemId: 'raw-fish', count: 1 });
      const slots = player.inventory.snapshot();
      slots[player.actor.selectedSlot] =
        held.instance.durability === 1 ? null : { ...held, instance: { durability: held.instance.durability - 1 } };
      player.inventory.replace(slots);
    }
    player.actor.inventory.replace(player.inventory.snapshot());
    this.#fishing.delete(playerId);
    this.context.changed();
    return { success: true as const, caught: state.ready };
  }

  milkCow(playerId: string, cowId: string) {
    const player = playerInventory(this.context, playerId),
      cow = this.context.entities.get(cowId);
    if (!player || cow?.archetype !== 'cow' || !cow.health || distance(player.entity.position, cow.position) > 5)
      return { success: false as const, reason: 'invalid-cow' };
    if (player.inventory.slot(player.actor.selectedSlot)?.itemId !== 'bucket')
      return { success: false as const, reason: 'requires-bucket' };
    const slots = player.inventory.snapshot();
    slots[player.actor.selectedSlot] = { itemId: 'milk-bucket', count: 1 };
    player.actor.inventory.replace(slots);
    this.context.changed();
    return { success: true as const };
  }

  drinkMilk(playerId: string) {
    const player = playerInventory(this.context, playerId);
    if (!player || player.inventory.slot(player.actor.selectedSlot)?.itemId !== 'milk-bucket')
      return { success: false as const, reason: 'requires-milk-bucket' };
    const slots = player.inventory.snapshot();
    slots[player.actor.selectedSlot] = { itemId: 'bucket', count: 1 };
    player.actor.inventory.replace(slots);
    this.context.changed();
    return { success: true as const };
  }

  throwEgg(playerId: string, target: [number, number, number]) {
    const player = playerInventory(this.context, playerId),
      below = this.context.getLoadedVoxel?.([target[0], target[1] - 1, target[2]]);
    if (
      !player ||
      distance(player.entity.position, target) > 16 ||
      this.context.getLoadedVoxel?.(target) !== Voxel.Air ||
      ![Voxel.Grass, Voxel.Dirt, Voxel.Stone].includes(below as 1 | 2 | 3)
    )
      return { success: false as const, reason: 'invalid-target' };
    if (player.inventory.slot(player.actor.selectedSlot)?.itemId !== 'egg')
      return { success: false as const, reason: 'requires-egg' };
    const sequence = this.#eggSequence + 1,
      hatched = sequence % 8 === 0;
    if (hatched) {
      this.context.entities.validateCreateCapacity(1);
      if (this.context.entities.get('egg-chicken-' + sequence))
        return { success: false as const, reason: 'spawn-conflict' };
    }
    player.actor.inventory.removeFromSlot(player.actor.selectedSlot, 1);
    this.#eggSequence = sequence;
    const chicken = hatched ? this.context.spawnChicken('egg-chicken-' + sequence, target) : null;
    this.context.changed();
    return { success: true as const, hatched, chicken };
  }

  checkpoint(): LifeSkillsCheckpoint {
    return Object.freeze({
      version: 1,
      fishingSequence: this.#fishingSequence,
      eggSequence: this.#eggSequence,
      fishing: Object.freeze([...this.#fishing.values()].sort((a, b) => a.playerId.localeCompare(b.playerId))),
    });
  }

  restore(value: LifeSkillsCheckpoint = emptyCheckpoint()) {
    const checkpoint = validateLifeSkillsCheckpoint(value);
    this.#fishingSequence = checkpoint.fishingSequence;
    this.#eggSequence = checkpoint.eggSequence;
    this.#fishing.clear();
    for (const state of checkpoint.fishing) this.#fishing.set(state.playerId, state);
  }
}

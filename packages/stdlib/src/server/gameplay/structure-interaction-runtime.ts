import { Voxel } from '../../world/voxel';
import type { WorldEditBatch, WorldCommitResult } from '../game-server-types';
import type { EntityStore } from './entity-store';
import { Inventory } from './inventory';
import { positionsInRange, voxelCenter } from './gameplay-geometry';

type Position = [number, number, number];
type Context = Readonly<{
  entities: EntityStore;
  getLoadedVoxel?(position: Position): number | undefined;
  editBatch?(batch: WorldEditBatch): WorldCommitResult;
  getWorldTime(): number;
  setWorldTime?(hours: number): number;
  ignite(position: Position): void;
  changed(): void;
}>;
const replaceable = (voxel: number | undefined) => voxel === Voxel.Air || voxel === Voxel.Fire;
const same = (left: Position, right: Position) => left.every((value, axis) => value === right[axis]);

export class StructureInteractionRuntime {
  constructor(private readonly context: Context) {}
  place(playerId: string, at: Position) {
    const player = this.context.entities.get(playerId);
    if (player?.type !== 'player' || !positionsInRange(player.position, voxelCenter(at), 5))
      return { success: false as const, reason: 'invalid-player' };
    const actor = this.context.entities.actorStateAccess(playerId);
    const held = actor.inventory.slot(actor.selectedSlot);
    const structure = held?.itemId === 'wooden-door' ? Voxel.WoodenDoor : held?.itemId === 'bed' ? Voxel.Bed : null;
    if (!structure) return { success: false as const, reason: 'requires-structure-item' };
    const second: Position = structure === Voxel.WoodenDoor ? [at[0], at[1] + 1, at[2]] : [at[0] + 1, at[1], at[2]];
    if (!replaceable(this.context.getLoadedVoxel?.(at)) || !replaceable(this.context.getLoadedVoxel?.(second)))
      return { success: false as const, reason: 'target-occupied' };
    if ([at, second].some((position) => same(position, player.position.map(Math.floor) as Position)))
      return { success: false as const, reason: 'player-collision' };
    const inventory = new Inventory(actor.inventory.capacity, actor.inventory.snapshot(), actor.inventory.items);
    if (!inventory.removeFromSlot(actor.selectedSlot, 1)) return { success: false as const, reason: 'missing-item' };
    const commit = this.context.editBatch?.({
      actorId: playerId,
      edits: [at, second].map(([x, y, z]) => ({ x, y, z, value: structure })),
    });
    if (!commit?.committed) return { success: false as const, reason: 'world-not-changed' };
    actor.inventory.replace(inventory.snapshot());
    this.context.changed();
    return { success: true as const, commit };
  }
  sleep(playerId: string, at: Position) {
    const player = this.context.entities.get(playerId);
    const hour = ((this.context.getWorldTime() % 24) + 24) % 24;
    if (
      player?.type !== 'player' ||
      this.context.getLoadedVoxel?.(at) !== Voxel.Bed ||
      !positionsInRange(player.position, voxelCenter(at), 5)
    )
      return { success: false as const, reason: 'invalid-bed' };
    if (hour < 18 && hour >= 6) return { success: false as const, reason: 'not-night' };
    if (!this.context.setWorldTime) return { success: false as const, reason: 'time-unavailable' };
    const spawn: Position = [at[0] + 0.5, at[1] + 1, at[2] + 0.5];
    if (this.context.getLoadedVoxel?.([at[0], at[1] + 1, at[2]]) !== Voxel.Air)
      return { success: false as const, reason: 'unsafe-spawn' };
    this.context.entities.playerStateAccess(playerId).spawnPosition = spawn;
    const worldTime = this.context.setWorldTime(6);
    this.context.changed();
    return { success: true as const, spawnPosition: spawn, worldTime };
  }
  ignite(playerId: string, at: Position) {
    const player = this.context.entities.get(playerId);
    if (
      player?.type !== 'player' ||
      !positionsInRange(player.position, voxelCenter(at), 5) ||
      this.context.getLoadedVoxel?.(at) !== Voxel.Air
    )
      return { success: false as const, reason: 'invalid-fire-target' };
    const actor = this.context.entities.actorStateAccess(playerId);
    const held = actor.inventory.slot(actor.selectedSlot);
    if (held?.itemId !== 'flint-and-steel' || !held.instance)
      return { success: false as const, reason: 'requires-flint-and-steel' };
    const inventory = actor.inventory.snapshot();
    inventory[actor.selectedSlot] =
      held.instance.durability === 1 ? null : { ...held, instance: { durability: held.instance.durability - 1 } };
    this.context.ignite(at);
    actor.inventory.replace(inventory);
    this.context.changed();
    return { success: true as const };
  }
}

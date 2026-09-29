import { Voxel } from '../../world/voxel';
import type { WorldEditBatch, WorldCommitResult } from '../game-server-types';
import type { EntityStore } from './entity-store';
import type { ProjectileRuntime, ProjectileVector } from './projectile-runtime';
import { positionsInRange, voxelCenter } from './gameplay-geometry';
import { prepareEntityMutation } from './prepared-entity-mutation';

type Position = [number, number, number];
export type FinalEntitiesCheckpoint = Readonly<{
  version: 1;
  sequence: number;
  falling: readonly Readonly<{ id: string; position: Position; voxel: number; velocity: number }>[];
  paintings: readonly Readonly<{ id: string; position: Position }>[];
}>;
type Context = Readonly<{
  entities: EntityStore;
  projectiles: ProjectileRuntime;
  getLoadedVoxel?(position: Position): number | undefined;
  editBatch?(batch: WorldEditBatch): WorldCommitResult;
  changed(): void;
  canStrike(position: Position): boolean;
  strike(position: Position): void;
  damage(sourceId: string, targetId: string, amount: number): void;
  convertPigs(pigs: readonly Readonly<{ id: string; position: Position }>[], sequence: number): void;
}>;
const empty = (): FinalEntitiesCheckpoint => ({ version: 1, sequence: 0, falling: [], paintings: [] });
const pos = (p: readonly number[]): Position => {
  if (p.length !== 3 || !p.every(Number.isFinite)) throw new TypeError('Final entity position is invalid.');
  return [p[0], p[1], p[2]];
};
export function validateFinalEntitiesCheckpoint(value: FinalEntitiesCheckpoint = empty()): FinalEntitiesCheckpoint {
  if (
    value.version !== 1 ||
    !Number.isSafeInteger(value.sequence) ||
    value.sequence < 0 ||
    !Array.isArray(value.falling) ||
    !Array.isArray(value.paintings)
  )
    throw new TypeError('Final entities checkpoint is invalid.');
  const ids = new Set<string>();
  const falling = value.falling.map((entry) => {
    if (
      !entry.id?.trim() ||
      ids.has(entry.id) ||
      ![Voxel.Sand, Voxel.Gravel].includes(entry.voxel as 6 | 43) ||
      !Number.isFinite(entry.velocity)
    )
      throw new TypeError('Falling entity is invalid.');
    ids.add(entry.id);
    return Object.freeze({ ...entry, position: pos(entry.position) });
  });
  const paintings = value.paintings.map((entry) => {
    if (!entry.id?.trim() || ids.has(entry.id)) throw new TypeError('Painting entity is invalid.');
    ids.add(entry.id);
    return Object.freeze({ ...entry, position: pos(entry.position) });
  });
  return Object.freeze({
    version: 1,
    sequence: value.sequence,
    falling: Object.freeze(falling),
    paintings: Object.freeze(paintings),
  });
}
export class FinalEntitiesRuntime {
  #sequence = 0;
  readonly #falling = new Map<string, FinalEntitiesCheckpoint['falling'][number]>();
  readonly #paintings = new Map<string, FinalEntitiesCheckpoint['paintings'][number]>();
  constructor(
    private readonly context: Context,
    checkpoint?: FinalEntitiesCheckpoint,
  ) {
    this.restore(checkpoint);
  }
  throwSnowball(playerId: string, direction: ProjectileVector) {
    const entity = this.context.entities.get(playerId);
    if (entity?.type !== 'player') return { success: false as const, reason: 'invalid-player' };
    const actor = this.context.entities.actorStateAccess(playerId);
    if (actor.inventory.slot(actor.selectedSlot)?.itemId !== 'snowball')
      return { success: false as const, reason: 'requires-snowball' };
    const projectile = this.context.projectiles.fire({
      ownerId: playerId,
      position: { x: entity.position[0], y: entity.position[1] + 1.4, z: entity.position[2] },
      direction,
      speed: 14,
      damage: 0,
      lifetimeSeconds: 3,
    });
    actor!.inventory.removeFromSlot(actor!.selectedSlot, 1);
    this.context.changed();
    return { success: true as const, projectile };
  }
  strikeLightning(at: Position) {
    if (!this.context.canStrike(at)) return { success: false as const, reason: 'lightning-unavailable' };
    const sequence = ++this.#sequence;
    this.context.strike(at);
    const pigs: { id: string; position: Position }[] = [];
    for (const entity of this.context.entities.query().sort((a, b) => a.id.localeCompare(b.id))) {
      if (!['player', 'creature', 'npc'].includes(entity.type) || !entity.health) continue;
      if (Math.hypot(...entity.position.map((value, index) => value - at[index])) > 2) continue;
      if (entity.archetype === 'pig') pigs.push({ id: entity.id, position: pos(entity.position) });
      else this.context.damage(`lightning-${sequence}`, entity.id, 5);
    }
    this.context.convertPigs(pigs, sequence);
    this.context.changed();
    return { success: true as const, id: `lightning-${sequence}` };
  }
  spawnFallingSand(at: Position, voxel: number) {
    if (![Voxel.Sand, Voxel.Gravel].includes(voxel as 6 | 43))
      return { success: false as const, reason: 'invalid-falling-voxel' };
    if (this.context.getLoadedVoxel?.(at) !== voxel) return { success: false as const, reason: 'source-mismatch' };
    const sequence = this.#sequence + 1;
    const state = Object.freeze({ id: `falling-${sequence}`, position: pos(at), voxel, velocity: 0 });
    try {
      this.context.entities.validateCreateIdentities(1, [state.id]);
    } catch {
      return { success: false as const, reason: 'identity-unavailable' };
    }
    const commit = this.context.editBatch?.({
      actorId: state.id,
      edits: [{ x: at[0], y: at[1], z: at[2], value: Voxel.Air }],
    });
    if (!commit?.committed) return { success: false as const, reason: 'world-edit-rejected' };
    this.context.entities.spawn({ id: state.id, type: 'falling-block', position: state.position });
    this.#sequence = sequence;
    this.#falling.set(state.id, state);
    this.context.changed();
    return { success: true as const, entity: state };
  }
  placePainting(playerId: string, at: Position) {
    const player = this.context.entities.get(playerId);
    const actor = player?.type === 'player' ? this.context.entities.actorStateAccess(playerId) : null;
    if (
      player?.type !== 'player' ||
      actor?.inventory.slot(actor.selectedSlot)?.itemId !== 'painting' ||
      !positionsInRange(player.position, voxelCenter(at), 5) ||
      this.context.getLoadedVoxel?.(at) === Voxel.Air
    )
      return { success: false as const, reason: 'invalid-painting-anchor' };
    const sequence = this.#sequence + 1;
    const state = Object.freeze({ id: `painting-${sequence}`, position: pos(at) });
    try {
      this.context.entities.validateCreateIdentities(1, [state.id]);
    } catch {
      return { success: false as const, reason: 'identity-unavailable' };
    }
    this.context.entities.spawn({ id: state.id, type: 'painting', position: state.position });
    actor.inventory.removeFromSlot(actor.selectedSlot, 1);
    this.#sequence = sequence;
    this.#paintings.set(state.id, state);
    this.context.changed();
    return { success: true as const, entity: state };
  }
  advance(seconds: number) {
    if (!Number.isFinite(seconds) || seconds <= 0) throw new TypeError('Final entities advance is invalid.');
    let changed = false;
    for (const [id, state] of this.#falling) {
      const velocity = state.velocity - 18 * seconds,
        nextY = state.position[1] + velocity * seconds;
      let support: number | null = null,
        unavailable = false;
      for (let y = Math.floor(state.position[1]) - 1; y >= Math.floor(nextY) - 1; y--) {
        const voxel = this.context.getLoadedVoxel?.([state.position[0], y, state.position[2]]);
        if (voxel === undefined) {
          unavailable = true;
          break;
        }
        if (voxel !== Voxel.Air) {
          support = y;
          break;
        }
      }
      if (unavailable) continue;
      if (support !== null) {
        const at: Position = [state.position[0], support + 1, state.position[2]];
        const commit = this.context.editBatch?.({
          actorId: id,
          edits: [{ x: at[0], y: at[1], z: at[2], value: state.voxel }],
        });
        if (commit?.committed) {
          this.#falling.delete(id);
          this.context.entities.despawn(id);
          changed = true;
        }
      } else {
        const position: Position = [state.position[0], nextY, state.position[2]];
        this.#falling.set(id, Object.freeze({ ...state, position, velocity }));
        this.context.entities.move(id, position);
        changed = true;
      }
    }
    for (const [id, state] of this.#paintings)
      if (this.context.getLoadedVoxel?.(state.position) === Voxel.Air) {
        const reference = this.context.entities.createReference(id);
        if (!reference) throw new Error(`Painting entity is missing: ${id}`);
        const mutation = prepareEntityMutation(this.context.entities, {
          despawns: [reference],
          spawns: [{ id: `${id}:drop`, position: state.position, stack: { itemId: 'painting', count: 1 } }],
        });
        mutation.validate();
        mutation.apply();
        this.#paintings.delete(id);
        changed = true;
      }
    if (changed) this.context.changed();
  }
  checkpoint(): FinalEntitiesCheckpoint {
    return validateFinalEntitiesCheckpoint({
      version: 1,
      sequence: this.#sequence,
      falling: [...this.#falling.values()],
      paintings: [...this.#paintings.values()],
    });
  }
  restore(value?: FinalEntitiesCheckpoint) {
    const state = validateFinalEntitiesCheckpoint(value);
    this.#sequence = state.sequence;
    this.#falling.clear();
    this.#paintings.clear();
    for (const entry of state.falling) {
      const entity = this.context.entities.get(entry.id);
      if (entity?.type !== 'falling-block') throw new TypeError(`Falling entity owner is missing: ${entry.id}`);
      this.#falling.set(entry.id, entry);
    }
    for (const entry of state.paintings) {
      const entity = this.context.entities.get(entry.id);
      if (entity?.type !== 'painting') throw new TypeError(`Painting entity owner is missing: ${entry.id}`);
      this.#paintings.set(entry.id, entry);
    }
  }
}

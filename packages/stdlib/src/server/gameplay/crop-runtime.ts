import { Voxel } from '../../world/voxel';
import type { EntityStore } from './entity-store';
import { Inventory } from './inventory';
import { advanceCrop, harvestCrop, plantCrop } from './modules/crop-growth-policy';

type Position = readonly [number, number, number];
export type CropRecord = Readonly<{ position: Position; stage: number; subSeconds: number }>;
export type CropCheckpoint = Readonly<{ version: 1; tick: number; crops: readonly CropRecord[] }>;
type Context = Readonly<{
  seed: number;
  entities: EntityStore;
  getLoadedVoxel?(position: [number, number, number]): number | undefined;
  changed(): void;
}>;
const key = (position: Position) => position.join(',');
const copy = (crop: CropRecord): CropRecord =>
  Object.freeze({ ...crop, position: Object.freeze([...crop.position] as [number, number, number]) });
const empty = (): CropCheckpoint => ({ version: 1, tick: 0, crops: [] });

export function validateCropCheckpoint(value: CropCheckpoint = empty()): CropCheckpoint {
  if (value.version !== 1 || !Number.isSafeInteger(value.tick) || value.tick < 0 || !Array.isArray(value.crops))
    throw new TypeError('Crop checkpoint is invalid.');
  const positions = new Set<string>();
  const crops = value.crops.map((crop) => {
    if (crop.position.length !== 3 || !crop.position.every(Number.isSafeInteger) || positions.has(key(crop.position)))
      throw new TypeError('Crop position is invalid.');
    advanceCrop({ stage: crop.stage, subSeconds: crop.subSeconds }, 0, 10);
    positions.add(key(crop.position));
    return copy(crop);
  });
  return Object.freeze({ version: 1, tick: value.tick, crops: Object.freeze(crops) });
}

export class CropRuntime {
  #tick = 0;
  readonly #crops = new Map<string, CropRecord>();
  constructor(
    private readonly context: Context,
    checkpoint?: CropCheckpoint,
  ) {
    this.restore(checkpoint);
  }
  plant(playerId: string, position: [number, number, number]) {
    const entity = this.context.entities.get(playerId);
    if (entity?.type !== 'player') return { success: false as const, reason: 'invalid-player' };
    const actor = this.context.entities.actorStateAccess(playerId);
    if (actor.inventory.slot(actor.selectedSlot)?.itemId !== 'wheat-seeds')
      return { success: false as const, reason: 'requires-seeds' };
    if (this.#crops.has(key(position))) return { success: false as const, reason: 'occupied' };
    if (
      this.context.getLoadedVoxel?.(position) !== Voxel.Farmland ||
      this.context.getLoadedVoxel?.([position[0], position[1] + 1, position[2]]) !== Voxel.Air
    )
      return { success: false as const, reason: 'invalid-farmland' };
    const state = plantCrop(Voxel.Farmland);
    actor.inventory.removeFromSlot(actor.selectedSlot, 1);
    const crop = copy({ position, stage: state.stage, subSeconds: 0 });
    this.#crops.set(key(position), crop);
    this.context.changed();
    return { success: true as const, crop };
  }
  advance(seconds: number) {
    if (!Number.isFinite(seconds) || seconds <= 0) throw new TypeError('Crop advance is invalid.');
    const steps = Math.floor(seconds);
    for (let step = 0; step < steps; step++) {
      this.#tick++;
      for (const [id, crop] of [...this.#crops].sort(([a], [b]) => a.localeCompare(b))) {
        if (this.context.getLoadedVoxel?.([...crop.position]) !== Voxel.Farmland) continue;
        const hydrated = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ].some(
          ([x, z]) =>
            this.context.getLoadedVoxel?.([crop.position[0] + x * 2, crop.position[1], crop.position[2] + z * 2]) ===
            Voxel.Water,
        );
        if (!hydrated || ((Math.imul(this.context.seed ^ this.#tick, 0x45d9f3b) ^ id.length) >>> 0) % 3 !== 0) continue;
        const next = advanceCrop(crop, 10, 10);
        this.#crops.set(id, copy({ position: crop.position, stage: next.stage, subSeconds: next.subSeconds ?? 0 }));
      }
    }
    if (steps) this.context.changed();
  }
  harvest(playerId: string, position: [number, number, number]) {
    const crop = this.#crops.get(key(position));
    const entity = this.context.entities.get(playerId);
    if (!crop || entity?.type !== 'player') return { success: false as const, reason: 'missing-crop' };
    const actor = this.context.entities.actorStateAccess(playerId);
    const inventory = new Inventory(actor.inventory.capacity, actor.inventory.snapshot(), actor.inventory.items);
    const harvest = harvestCrop(crop);
    if (!harvest.drops.every((drop) => inventory.add(drop)))
      return { success: false as const, reason: 'inventory-full' };
    actor.inventory.replace(inventory.snapshot());
    this.#crops.delete(key(position));
    this.context.changed();
    return { success: true as const, mature: crop.stage === 7 };
  }
  list(): readonly CropRecord[] {
    return Object.freeze(
      [...this.#crops.values()].sort((a, b) => key(a.position).localeCompare(key(b.position))).map(copy),
    );
  }
  checkpoint(): CropCheckpoint {
    return validateCropCheckpoint({ version: 1, tick: this.#tick, crops: this.list() });
  }
  restore(value: CropCheckpoint = empty()) {
    const checkpoint = validateCropCheckpoint(value);
    this.#tick = checkpoint.tick;
    this.#crops.clear();
    for (const crop of checkpoint.crops) this.#crops.set(key(crop.position), copy(crop));
  }
}

import type { EntityStore } from './entity-store';
import { Inventory } from './inventory';
import { advanceCrop, harvestCrop, plantCrop } from './modules/crop-growth-policy';
import { freezeCropPolicy, type CropPolicy } from './modules/crop-policy';

type Position = readonly [number, number, number];
export type CropRecord = Readonly<{ position: Position; stage: number; subSeconds: number }>;
export type CropCheckpoint = Readonly<{
  version: 1;
  tick: number;
  fractionalSeconds?: number;
  crops: readonly CropRecord[];
}>;
type Context = Readonly<{
  policy?: CropPolicy;
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
  const fractionalSeconds = value.fractionalSeconds === undefined ? 0 : value.fractionalSeconds;
  if (
    value.version !== 1 ||
    !Number.isSafeInteger(value.tick) ||
    value.tick < 0 ||
    !Number.isFinite(fractionalSeconds) ||
    fractionalSeconds < 0 ||
    fractionalSeconds >= 1 ||
    !Array.isArray(value.crops)
  )
    throw new TypeError('Crop checkpoint is invalid.');
  const positions = new Set<string>();
  const crops = value.crops.map((crop) => {
    if (crop.position.length !== 3 || !crop.position.every(Number.isSafeInteger) || positions.has(key(crop.position)))
      throw new TypeError('Crop position is invalid.');
    advanceCrop({ stage: crop.stage, subSeconds: crop.subSeconds }, 0, 10);
    positions.add(key(crop.position));
    return copy(crop);
  });
  return Object.freeze({ version: 1, tick: value.tick, fractionalSeconds, crops: Object.freeze(crops) });
}

export class CropRuntime {
  readonly #policy: CropPolicy | undefined;
  #tick = 0;
  #fractionalSeconds = 0;
  readonly #crops = new Map<string, CropRecord>();
  constructor(
    private readonly context: Context,
    checkpoint?: CropCheckpoint,
  ) {
    this.#policy = context.policy ? freezeCropPolicy(context.policy) : undefined;
    this.restore(checkpoint);
  }
  at(position: Position): CropRecord | null {
    const crop = this.#crops.get(key(position));
    return crop ? copy(crop) : null;
  }
  /** A participant for the registered host; it never edits inventory or publishes a second gameplay revision. */
  preparePlant(position: Position, expected: CropRecord | null, next: CropRecord) {
    if (expected !== null || next.stage !== 0 || next.subSeconds !== 0) throw new Error('crop-interaction-stale');
    return this.prepareChange(position, expected, next);
  }
  /** The host owns inventory and publication; this participant changes only the crop child. */
  prepareChange(position: Position, expected: CropRecord | null, next: CropRecord | null) {
    const id = key(position),
      previous = this.at(position),
      candidate = next ? copy(next) : null;
    if (
      !this.#policy ||
      JSON.stringify(previous) !== JSON.stringify(expected) ||
      (candidate && key(candidate.position) !== id)
    )
      throw new Error('crop-interaction-stale');
    if (candidate) advanceCrop(candidate, 0, 10);
    let validated = false,
      used = false;
    return {
      validate: () => {
        validated = false;
        if (used || JSON.stringify(this.at(position)) !== JSON.stringify(previous))
          throw new Error('crop-interaction-stale');
        validated = true;
      },
      apply: () => {
        if (used || !validated) throw new Error('Crop participant requires validation.');
        used = true;
        if (candidate) this.#crops.set(id, candidate);
        else this.#crops.delete(id);
      },
    };
  }
  /** Uses the registered crop observation, including null, in the host's world transaction. */
  prepareSupportTransition(position: Position, expected: CropRecord | null, resultingSoilVoxel: number) {
    if (!this.#policy) throw new Error('crop-policy-unavailable');
    if (!Number.isSafeInteger(resultingSoilVoxel) || resultingSoilVoxel < 0 || resultingSoilVoxel > 65_535)
      throw new TypeError('Crop support voxel is invalid.');
    return this.prepareChange(
      position,
      expected,
      this.#policy.soilVoxels.includes(resultingSoilVoxel) ? expected : null,
    );
  }
  plant(playerId: string, position: [number, number, number]) {
    const policy = this.#policy;
    if (!policy) return { success: false as const, reason: 'crop-policy-unavailable' };
    const entity = this.context.entities.get(playerId);
    if (entity?.type !== 'player') return { success: false as const, reason: 'invalid-player' };
    const actor = this.context.entities.actorStateAccess(playerId);
    if (actor.inventory.slot(actor.selectedSlot)?.itemId !== policy.seedItemId)
      return { success: false as const, reason: 'requires-seeds' };
    if (this.#crops.has(key(position))) return { success: false as const, reason: 'occupied' };
    if (
      !policy.soilVoxels.includes(this.context.getLoadedVoxel?.(position) ?? -1) ||
      !policy.emptyAboveVoxels.includes(
        this.context.getLoadedVoxel?.([position[0], position[1] + 1, position[2]]) ?? -1,
      )
    )
      return { success: false as const, reason: 'invalid-farmland' };
    const state = plantCrop(this.context.getLoadedVoxel!(position)!, policy);
    actor.inventory.removeFromSlot(actor.selectedSlot, 1);
    const crop = copy({ position, stage: state.stage, subSeconds: 0 });
    this.#crops.set(key(position), crop);
    this.context.changed();
    return { success: true as const, crop };
  }
  advance(seconds: number) {
    if (!Number.isFinite(seconds) || seconds <= 0) throw new TypeError('Crop advance is invalid.');
    const totalSeconds = this.#fractionalSeconds + seconds;
    const roundingTolerance = Number.EPSILON * Math.max(1, totalSeconds) * 8;
    const steps = Math.floor(totalSeconds + roundingTolerance);
    const remainder = totalSeconds - steps;
    this.#fractionalSeconds = Math.abs(remainder) <= roundingTolerance ? 0 : Math.max(0, remainder);
    for (let step = 0; step < steps; step++) {
      this.#tick++;
      for (const [id, crop] of [...this.#crops].sort(([a], [b]) => a.localeCompare(b))) {
        const policy = this.#policy;
        if (!policy || !policy.soilVoxels.includes(this.context.getLoadedVoxel?.([...crop.position]) ?? -1)) continue;
        const hydrated = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ].some(([x, z]) =>
          policy.waterVoxels.includes(
            this.context.getLoadedVoxel?.([crop.position[0] + x * 2, crop.position[1], crop.position[2] + z * 2]) ?? -1,
          ),
        );
        if (!hydrated || ((Math.imul(this.context.seed ^ this.#tick, 0x45d9f3b) ^ id.length) >>> 0) % 3 !== 0) continue;
        const next = advanceCrop(crop, 10, 10);
        this.#crops.set(id, copy({ position: crop.position, stage: next.stage, subSeconds: next.subSeconds ?? 0 }));
      }
    }
    if (steps) this.context.changed();
  }
  harvest(playerId: string, position: [number, number, number]) {
    if (!this.#policy) return { success: false as const, reason: 'crop-policy-unavailable' };
    const crop = this.#crops.get(key(position));
    const entity = this.context.entities.get(playerId);
    if (!crop || entity?.type !== 'player') return { success: false as const, reason: 'missing-crop' };
    const actor = this.context.entities.actorStateAccess(playerId);
    const inventory = new Inventory(actor.inventory.capacity, actor.inventory.snapshot(), actor.inventory.items);
    const harvest = harvestCrop(crop, this.#policy);
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
    return validateCropCheckpoint({
      version: 1,
      tick: this.#tick,
      fractionalSeconds: this.#fractionalSeconds,
      crops: this.list(),
    });
  }
  restore(value: CropCheckpoint = empty()) {
    const checkpoint = validateCropCheckpoint(value);
    this.#tick = checkpoint.tick;
    this.#fractionalSeconds = checkpoint.fractionalSeconds ?? 0;
    this.#crops.clear();
    for (const crop of checkpoint.crops) this.#crops.set(key(crop.position), copy(crop));
  }
}

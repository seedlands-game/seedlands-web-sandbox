import { Voxel } from '../../../world/voxel';

export type CropState = Readonly<{ stage: number; subSeconds?: number }>;
export type CropHarvest = Readonly<{ drops: readonly Readonly<{ itemId: string; count: number }>[] }>;

/** Wheat matures through eight discrete stages, matching a single crop lifecycle. */
export const CROP_MATURE_STAGE = 7;

const validStage = (stage: number): boolean => Number.isSafeInteger(stage) && stage >= 0 && stage <= CROP_MATURE_STAGE;

/** Plants a fresh crop; only tilled farmland accepts seeds. */
export function plantCrop(targetVoxel: number): CropState {
  if (targetVoxel !== Voxel.Farmland) throw new Error('crop-requires-farmland');
  return Object.freeze({ stage: 0 });
}

/** Deterministic staged growth; leftover seconds accumulate toward the next stage, capped at maturity. */
export function advanceCrop(state: CropState, elapsedSeconds: number, secondsPerStage: number): CropState {
  const subSeconds = state?.subSeconds ?? 0;
  if (!state || !validStage(state.stage) || !Number.isFinite(subSeconds) || subSeconds < 0)
    throw new Error('crop-state-invalid');
  if (
    !Number.isFinite(elapsedSeconds) ||
    elapsedSeconds < 0 ||
    !Number.isFinite(secondsPerStage) ||
    secondsPerStage <= 0
  )
    throw new RangeError('crop-advance-out-of-range');
  if (state.stage >= CROP_MATURE_STAGE) return Object.freeze({ stage: CROP_MATURE_STAGE, subSeconds: 0 });
  const total = subSeconds + elapsedSeconds;
  const grown = Math.floor(total / secondsPerStage);
  const stage = Math.min(CROP_MATURE_STAGE, state.stage + grown);
  const nextSub = stage >= CROP_MATURE_STAGE ? 0 : total - grown * secondsPerStage;
  return Object.freeze({ stage, subSeconds: nextSub });
}

/** Harvest yields wheat only when mature; seeds are always recovered. */
export function harvestCrop(state: CropState): CropHarvest {
  if (!state || !validStage(state.stage)) throw new Error('crop-state-invalid');
  const drops =
    state.stage >= CROP_MATURE_STAGE
      ? [
          { itemId: 'wheat', count: 1 },
          { itemId: 'wheat-seeds', count: 1 },
        ]
      : [{ itemId: 'wheat-seeds', count: 1 }];
  return Object.freeze({ drops: Object.freeze(drops.map((drop) => Object.freeze(drop))) });
}

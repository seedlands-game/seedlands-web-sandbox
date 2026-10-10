import { BLOCK_LIGHT_MAX_LEVEL } from './block-light-volume';
import { createSurfaceLightingSample, type LinearRgb } from './surface-lighting';

type Frame = Readonly<{ skyRadiance: LinearRgb; blockLightTint: LinearRgb }>;
export function sampleWorldSurfaceLighting(
  sky: Readonly<{ ready: boolean; visibility: number }> | null,
  blockLight: number | null,
  frame: Frame,
  selfEmission: LinearRgb,
) {
  return createSurfaceLightingSample({
    skyVisibility: sky?.ready ? sky.visibility : null,
    skyRadiance: frame.skyRadiance,
    blockIrradiance:
      blockLight === null
        ? null
        : [
            (frame.blockLightTint[0] * blockLight) / BLOCK_LIGHT_MAX_LEVEL,
            (frame.blockLightTint[1] * blockLight) / BLOCK_LIGHT_MAX_LEVEL,
            (frame.blockLightTint[2] * blockLight) / BLOCK_LIGHT_MAX_LEVEL,
          ],
    selfEmission,
  });
}

export type WorldSurfaceLightingSampler = (
  position: readonly [number, number, number],
  frame: Frame,
  selfEmission: LinearRgb,
) => ReturnType<typeof sampleWorldSurfaceLighting>;

export function createWorldSurfaceLightingSampler(
  sky: Readonly<{
    sample(position: readonly [number, number, number]): Readonly<{ ready: boolean; visibility: number }> | null;
  }>,
  block: Readonly<{ sampleKnown(position: readonly [number, number, number]): number | null }>,
): WorldSurfaceLightingSampler {
  return (position, frame, self) =>
    sampleWorldSurfaceLighting(sky.sample(position), block.sampleKnown(position), frame, self);
}

export function createPresentedSurfaceLightingSampler(
  current: () => readonly [Readonly<{ sampleSurfaceLighting: WorldSurfaceLightingSampler }> | null, Frame | undefined],
): import('./surface-lighting').SurfaceLightingSampler {
  return (position, self) => {
    const [world, frame] = current();
    return world && frame
      ? world.sampleSurfaceLighting(position, frame, self)
      : createSurfaceLightingSample({
          skyVisibility: null,
          skyRadiance: null,
          blockIrradiance: null,
          selfEmission: self,
        });
  };
}

import { BLOCK_LIGHT_MAX_LEVEL } from './block-light-volume';
import { createSurfaceLightingSample, type LinearRgb, type SurfaceLightingSampler } from './surface-lighting';

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

export type WorldSurfaceLightingSampler = ((
  position: readonly [number, number, number],
  frame: Frame,
  selfEmission: LinearRgb,
) => ReturnType<typeof sampleWorldSurfaceLighting>) &
  Readonly<{
    batch?: (
      position: readonly [number, number, number],
      frame: Frame,
      selfEmissions: readonly LinearRgb[],
    ) => readonly ReturnType<typeof sampleWorldSurfaceLighting>[];
  }>;

export function createWorldSurfaceLightingSampler(
  sky: Readonly<{
    sample(position: readonly [number, number, number]): Readonly<{ ready: boolean; visibility: number }> | null;
  }>,
  block: Readonly<{ sampleKnown(position: readonly [number, number, number]): number | null }>,
): WorldSurfaceLightingSampler {
  const sample: WorldSurfaceLightingSampler = (position, frame, self) =>
    sampleWorldSurfaceLighting(sky.sample(position), block.sampleKnown(position), frame, self);
  return Object.assign(sample, {
    batch(position: readonly [number, number, number], frame: Frame, selfEmissions: readonly LinearRgb[]) {
      if (!selfEmissions.length) return [];
      const skyValue = sky.sample(position);
      const blockValue = block.sampleKnown(position);
      return selfEmissions.map((self) => sampleWorldSurfaceLighting(skyValue, blockValue, frame, self));
    },
  });
}

export function createPresentedSurfaceLightingSampler(
  current: () => readonly [Readonly<{ sampleSurfaceLighting: WorldSurfaceLightingSampler }> | null, Frame | undefined],
): SurfaceLightingSampler {
  const sample: SurfaceLightingSampler = (position, self) => {
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
  return Object.assign(sample, {
    batch(position: readonly [number, number, number], selfEmissions: readonly LinearRgb[]) {
      if (!selfEmissions.length) return [];
      const [world, frame] = current();
      if (world && frame) {
        const sampler = world.sampleSurfaceLighting;
        return sampler.batch
          ? sampler.batch(position, frame, selfEmissions)
          : selfEmissions.map((self) => world.sampleSurfaceLighting(position, frame, self));
      }
      return selfEmissions.map((self) =>
        createSurfaceLightingSample({
          skyVisibility: null,
          skyRadiance: null,
          blockIrradiance: null,
          selfEmission: self,
        }),
      );
    },
  });
}

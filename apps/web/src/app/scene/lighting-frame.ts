import type { PackLightingProfile } from '../../client/presentation/pack-lighting-profile';
import { sampleEnvironment, type Rgb } from './environment-palette';

const mixRgb = (a: Rgb, b: Rgb, amount: number): Rgb => [
  a[0] + (b[0] - a[0]) * amount,
  a[1] + (b[1] - a[1]) * amount,
  a[2] + (b[2] - a[2]) * amount,
];

/** Explicit legacy-schema compatibility; no Pack identity is inferred. */
export function sampleLightingFrame(profile: PackLightingProfile | undefined, hour: number) {
  if (!Number.isFinite(hour)) throw new RangeError('Lighting time must be finite.');
  const time = ((hour % 24) + 24) % 24;
  if (!profile) {
    const environment = sampleEnvironment(time);
    return {
      environment,
      skyRadiance: [environment.ambient[0] ** 2.2, environment.ambient[1] ** 2.2, environment.ambient[2] ** 2.2] as Rgb,
      blockLightTint: [1, 1, 1] as Rgb,
    };
  }
  const frames = profile.environmentKeyframes;
  const rightIndex = frames.findIndex((frame, index) => index > 0 && time <= frame.hour);
  const right = frames[rightIndex]!;
  const left = frames[rightIndex - 1]!;
  const amount = (time - left.hour) / (right.hour - left.hour);
  return {
    environment: {
      top: mixRgb(left.top, right.top, amount),
      horizon: mixRgb(left.horizon, right.horizon, amount),
      fog: mixRgb(left.fog, right.fog, amount),
      ambient: mixRgb(left.ambient, right.ambient, amount),
      sun: mixRgb(left.sun, right.sun, amount),
      intensity: left.intensity + (right.intensity - left.intensity) * amount,
    },
    skyRadiance: mixRgb(left.skyRadiance, right.skyRadiance, amount),
    blockLightTint: profile.blockLightTint,
  };
}

export type Rgb = readonly [number, number, number];

type EnvironmentKeyframe = {
  hour: number;
  top: Rgb;
  horizon: Rgb;
  fog: Rgb;
  ambient: Rgb;
  sun: Rgb;
  intensity: number;
};

const ENVIRONMENT_KEYFRAMES: readonly EnvironmentKeyframe[] = [
  {
    hour: 0,
    top: [5, 11, 28],
    horizon: [18, 29, 56],
    fog: [12, 22, 42],
    ambient: [0.26, 0.29, 0.39],
    sun: [0.35, 0.45, 0.72],
    intensity: 0,
  },
  {
    hour: 5,
    top: [9, 18, 39],
    horizon: [48, 48, 72],
    fog: [31, 37, 57],
    ambient: [0.25, 0.28, 0.38],
    sun: [0.63, 0.55, 0.62],
    intensity: 0.05,
  },
  {
    hour: 6.5,
    top: [44, 78, 122],
    horizon: [244, 142, 94],
    fog: [151, 112, 104],
    ambient: [0.38, 0.34, 0.36],
    sun: [1, 0.55, 0.3],
    intensity: 0.62,
  },
  {
    hour: 9,
    top: [76, 143, 196],
    horizon: [188, 221, 221],
    fog: [151, 190, 202],
    ambient: [0.52, 0.6, 0.66],
    sun: [1, 0.91, 0.72],
    intensity: 1.18,
  },
  {
    hour: 16.5,
    top: [66, 132, 188],
    horizon: [192, 218, 210],
    fog: [145, 181, 193],
    ambient: [0.51, 0.57, 0.61],
    sun: [1, 0.88, 0.67],
    intensity: 1.08,
  },
  {
    hour: 18.5,
    top: [52, 68, 120],
    horizon: [247, 111, 69],
    fog: [150, 86, 83],
    ambient: [0.35, 0.28, 0.31],
    sun: [1, 0.42, 0.2],
    intensity: 0.56,
  },
  {
    hour: 20,
    top: [11, 20, 44],
    horizon: [69, 52, 78],
    fog: [36, 34, 53],
    ambient: [0.24, 0.27, 0.37],
    sun: [0.47, 0.48, 0.68],
    intensity: 0.03,
  },
  {
    hour: 24,
    top: [5, 11, 28],
    horizon: [18, 29, 56],
    fog: [12, 22, 42],
    ambient: [0.26, 0.29, 0.39],
    sun: [0.35, 0.45, 0.72],
    intensity: 0,
  },
];

export const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const mix = (a: number, b: number, amount: number) => a + (b - a) * amount;
const mixRgb = (a: Rgb, b: Rgb, amount: number): Rgb => [
  mix(a[0], b[0], amount),
  mix(a[1], b[1], amount),
  mix(a[2], b[2], amount),
];

export const cssRgb = ([r, g, b]: Rgb) => {
  const scale = Math.max(r, g, b) <= 1 ? 255 : 1;
  return `rgb(${Math.round(r * scale)} ${Math.round(g * scale)} ${Math.round(b * scale)})`;
};

export function sampleEnvironment(hour: number) {
  const normalized = ((hour % 24) + 24) % 24;
  let left = ENVIRONMENT_KEYFRAMES[0];
  let right = ENVIRONMENT_KEYFRAMES[1];
  for (let index = 1; index < ENVIRONMENT_KEYFRAMES.length; index += 1) {
    right = ENVIRONMENT_KEYFRAMES[index];
    if (normalized <= right.hour) break;
    left = right;
  }
  const amount = clamp01((normalized - left.hour) / Math.max(0.001, right.hour - left.hour));
  return {
    top: mixRgb(left.top, right.top, amount),
    horizon: mixRgb(left.horizon, right.horizon, amount),
    fog: mixRgb(left.fog, right.fog, amount),
    ambient: mixRgb(left.ambient, right.ambient, amount),
    sun: mixRgb(left.sun, right.sun, amount),
    intensity: mix(left.intensity, right.intensity, amount),
  };
}

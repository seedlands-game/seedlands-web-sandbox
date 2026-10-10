export const SURFACE_LIGHTING_MAX_RADIANCE = 16;
export const SURFACE_LIGHTING_MAX_RECEIVED_RADIANCE = SURFACE_LIGHTING_MAX_RADIANCE * 2;

export type LinearRgb = readonly [number, number, number];

export type SurfaceLightingSampleInput = Readonly<{
  skyVisibility: number | null;
  skyRadiance: LinearRgb | null;
  blockIrradiance: LinearRgb | null;
  selfEmission: LinearRgb;
}>;

export type SurfaceLightingSample =
  | Readonly<{
      ready: false;
      skyVisibility: 0;
      skyRadiance: LinearRgb;
      blockIrradiance: LinearRgb;
      selfEmission: LinearRgb;
    }>
  | Readonly<{
      ready: true;
      skyVisibility: number;
      skyRadiance: LinearRgb;
      blockIrradiance: LinearRgb;
      selfEmission: LinearRgb;
    }>;

export type SurfaceLightingSampler = ((
  position: readonly [number, number, number],
  selfEmission: LinearRgb,
) => SurfaceLightingSample) &
  Readonly<{
    /** One synchronous model uses a coherent world frame, with each material's own emission. */
    batch?: (
      position: readonly [number, number, number],
      selfEmissions: readonly LinearRgb[],
    ) => readonly SurfaceLightingSample[];
  }>;

export type SurfaceLightingChannels = Readonly<{
  receivedLighting: LinearRgb;
  selfEmission: LinearRgb;
}>;

export type SurfaceLightingMaterialAdapter = Readonly<{
  apply(channels: SurfaceLightingChannels): void;
}>;

const ZERO_RGB = Object.freeze([0, 0, 0]) as LinearRgb;

function finiteBounded(value: unknown, minimum: number, maximum: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum)
    throw new RangeError(label + ' must be finite and within ' + minimum + '..' + maximum + '.');
  return value;
}

function freezeLinearRgb(value: unknown, label: string, maximum = SURFACE_LIGHTING_MAX_RADIANCE): LinearRgb {
  if (!Array.isArray(value) || value.length !== 3 || Object.keys(value).length !== 3)
    throw new TypeError(label + ' must contain exactly three channels.');
  return Object.freeze([
    finiteBounded(value[0], 0, maximum, label + '.r'),
    finiteBounded(value[1], 0, maximum, label + '.g'),
    finiteBounded(value[2], 0, maximum, label + '.b'),
  ]);
}

export function createSurfaceLightingSample(input: SurfaceLightingSampleInput): SurfaceLightingSample {
  if (!input || typeof input !== 'object') throw new TypeError('Surface lighting input is invalid.');
  const selfEmission = freezeLinearRgb(input.selfEmission, 'selfEmission');
  const skyVisibility = input.skyVisibility === null ? null : finiteBounded(input.skyVisibility, 0, 1, 'skyVisibility');
  const skyRadiance = input.skyRadiance === null ? null : freezeLinearRgb(input.skyRadiance, 'skyRadiance');
  const blockIrradiance =
    input.blockIrradiance === null ? null : freezeLinearRgb(input.blockIrradiance, 'blockIrradiance');
  const ready = input.skyVisibility !== null && input.skyRadiance !== null && input.blockIrradiance !== null;
  if (!ready)
    return Object.freeze({
      ready: false,
      skyVisibility: 0,
      skyRadiance: ZERO_RGB,
      blockIrradiance: ZERO_RGB,
      selfEmission,
    });
  return Object.freeze({
    ready: true,
    skyVisibility: skyVisibility!,
    skyRadiance: skyRadiance!,
    blockIrradiance: blockIrradiance!,
    selfEmission,
  });
}

export function combineSurfaceLighting(sample: SurfaceLightingSample): SurfaceLightingChannels {
  if (sample.ready !== true && sample.ready !== false) throw new TypeError('Surface lighting readiness is invalid.');
  if (sample.ready === false) {
    finiteBounded(sample.skyVisibility, 0, 1, 'skyVisibility');
    freezeLinearRgb(sample.skyRadiance, 'skyRadiance');
    freezeLinearRgb(sample.blockIrradiance, 'blockIrradiance');
    return Object.freeze({
      receivedLighting: ZERO_RGB,
      selfEmission: freezeLinearRgb(sample.selfEmission, 'selfEmission'),
    });
  }
  const checked = createSurfaceLightingSample(sample);
  const receivedLighting = freezeLinearRgb(
    checked.skyRadiance.map((channel, index) => channel * checked.skyVisibility + checked.blockIrradiance[index]!),
    'receivedLighting',
    SURFACE_LIGHTING_MAX_RECEIVED_RADIANCE,
  );
  return Object.freeze({ receivedLighting, selfEmission: checked.selfEmission });
}

export function applySurfaceLightingToMaterial(
  adapter: SurfaceLightingMaterialAdapter,
  sample: SurfaceLightingSample,
): SurfaceLightingChannels {
  if (!adapter || typeof adapter.apply !== 'function') throw new TypeError('Surface lighting adapter is invalid.');
  const channels = combineSurfaceLighting(sample);
  adapter.apply(channels);
  return channels;
}

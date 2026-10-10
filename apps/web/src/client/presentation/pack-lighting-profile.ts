export type PackLightingProfile = Readonly<{
  schemaVersion: 1;
  blockLightTint: readonly [number, number, number];
  surfaceSelfEmission: Readonly<
    Record<string, Readonly<{ color: readonly [number, number, number]; intensity: number }>>
  >;
  environmentKeyframes: readonly Readonly<{
    hour: number;
    top: readonly [number, number, number];
    horizon: readonly [number, number, number];
    fog: readonly [number, number, number];
    ambient: readonly [number, number, number];
    sun: readonly [number, number, number];
    intensity: number;
    skyRadiance: readonly [number, number, number];
  }>[];
  toneMapper: 'linear' | 'aces';
  exposure: number;
}>;

const plain = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};
const keysAre = (value: Record<string, unknown>, keys: readonly string[]) => {
  const own = Reflect.ownKeys(value);
  return (
    own.length === keys.length &&
    own.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return typeof key === 'string' && keys.includes(key) && descriptor?.enumerable === true && 'value' in descriptor;
    })
  );
};
const denseArray = (value: unknown, min: number, max: number): value is unknown[] => {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length < min ||
    value.length > max ||
    Reflect.ownKeys(value).length !== value.length + 1
  )
    return false;
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !('value' in descriptor)) return false;
  }
  return true;
};
const finite = (value: unknown, min: number, max: number, openMin = false): value is number =>
  typeof value === 'number' && Number.isFinite(value) && (openMin ? value > min : value >= min) && value <= max;
const rgb = (value: unknown, max: number): value is readonly [number, number, number] =>
  denseArray(value, 3, 3) && value.every((channel) => finite(channel, 0, max));
const same = (a: unknown, b: unknown) =>
  Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => value === b[index]);

/** Validates untrusted Pack lighting metadata without inferring a profile from a Pack ID. */
export function parsePackLightingProfile(value: unknown): PackLightingProfile {
  if (
    !plain(value) ||
    !keysAre(value, [
      'schemaVersion',
      'blockLightTint',
      'surfaceSelfEmission',
      'environmentKeyframes',
      'toneMapper',
      'exposure',
    ]) ||
    value.schemaVersion !== 1 ||
    !rgb(value.blockLightTint, 16) ||
    !plain(value.surfaceSelfEmission) ||
    !denseArray(value.environmentKeyframes, 2, 32) ||
    (value.toneMapper !== 'linear' && value.toneMapper !== 'aces') ||
    !finite(value.exposure, 0, 16, true)
  )
    throw new TypeError('Pack lighting profile is invalid.');

  const emissions: Record<string, { color: readonly [number, number, number]; intensity: number }> = {};
  for (const materialId of Reflect.ownKeys(value.surfaceSelfEmission)) {
    const descriptor = Object.getOwnPropertyDescriptor(value.surfaceSelfEmission, materialId);
    if (
      typeof materialId !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(materialId) ||
      Object.hasOwn(emissions, materialId) ||
      !descriptor?.enumerable ||
      !('value' in descriptor)
    )
      throw new TypeError('Pack lighting material reference is invalid.');
    const emission = value.surfaceSelfEmission[materialId];
    if (
      !plain(emission) ||
      !keysAre(emission, ['color', 'intensity']) ||
      !rgb(emission.color, 16) ||
      !finite(emission.intensity, 0, 16)
    )
      throw new TypeError('Pack surface self-emission is invalid.');
    const intensity = emission.intensity;
    if (emission.color.some((channel) => channel * intensity > 16))
      throw new TypeError('Pack composed self-emission exceeds the surface sample bound.');
    emissions[materialId] = Object.freeze({
      color: Object.freeze([...emission.color]) as unknown as readonly [number, number, number],
      intensity: emission.intensity,
    });
  }

  const frames = value.environmentKeyframes.map((frame: unknown) => {
    if (
      !plain(frame) ||
      !keysAre(frame, ['hour', 'top', 'horizon', 'fog', 'ambient', 'sun', 'intensity', 'skyRadiance']) ||
      !finite(frame.hour, 0, 24) ||
      !rgb(frame.top, 1) ||
      !rgb(frame.horizon, 1) ||
      !rgb(frame.fog, 1) ||
      !rgb(frame.ambient, 1) ||
      !rgb(frame.sun, 1) ||
      !finite(frame.intensity, 0, 16) ||
      !rgb(frame.skyRadiance, 16)
    )
      throw new TypeError('Pack environment keyframe is invalid.');
    return Object.freeze({
      hour: frame.hour,
      top: Object.freeze([...frame.top]) as unknown as readonly [number, number, number],
      horizon: Object.freeze([...frame.horizon]) as unknown as readonly [number, number, number],
      fog: Object.freeze([...frame.fog]) as unknown as readonly [number, number, number],
      ambient: Object.freeze([...frame.ambient]) as unknown as readonly [number, number, number],
      sun: Object.freeze([...frame.sun]) as unknown as readonly [number, number, number],
      intensity: frame.intensity,
      skyRadiance: Object.freeze([...frame.skyRadiance]) as unknown as readonly [number, number, number],
    });
  });
  if (
    frames[0].hour !== 0 ||
    frames[frames.length - 1].hour !== 24 ||
    frames.some((frame, index) => index > 0 && frame.hour <= frames[index - 1].hour)
  )
    throw new TypeError('Pack environment keyframes must increase from hour 0 through hour 24.');
  const first = frames[0];
  const last = frames[frames.length - 1];
  if (
    !(['top', 'horizon', 'fog', 'ambient', 'sun', 'skyRadiance'] as const).every((key) =>
      same(first[key], last[key]),
    ) ||
    first.intensity !== last.intensity
  )
    throw new TypeError('Pack environment keyframes must close the daily cycle.');
  return Object.freeze({
    schemaVersion: 1,
    blockLightTint: Object.freeze([...value.blockLightTint]) as unknown as readonly [number, number, number],
    surfaceSelfEmission: Object.freeze(emissions),
    environmentKeyframes: Object.freeze(frames),
    toneMapper: value.toneMapper,
    exposure: value.exposure,
  });
}

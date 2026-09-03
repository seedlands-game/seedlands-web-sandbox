export const MACRO_REGION_SIZE = 256;

export type MacroBiome = 'plains' | 'forest' | 'mountain' | 'dry' | 'cold' | 'wet';
export type HydrologyKind = 'dry' | 'river' | 'lake';
export type RiverDescriptor = {
  id: string;
  source: readonly [number, number];
  path: readonly (readonly [number, number])[];
  width: number;
  waterLevel: number;
  direction: readonly [number, number];
};
export type Hydrology = {
  kind: HydrologyKind;
  id: string | null;
  distance: number;
  water: boolean;
  waterLevel: number | null;
  direction: readonly [number, number] | null;
};
export type MacroContext = {
  region: readonly [number, number];
  continentalness: number;
  baseElevation: number;
  relief: number;
  erosion: number;
  temperature: number;
  humidity: number;
  biome: MacroBiome;
  terrainHeight: number;
  hydrology: Hydrology;
};

const RIVER_CELL = 768;
const LAKE_CELL = 1024;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const floorDiv = (value: number, divisor: number) => Math.floor(value / divisor);
const smooth = (value: number) => value * value * (3 - 2 * value);

function hash(seed: number, x: number, z: number): number {
  let value = (seed ^ Math.imul(x, 374761393) ^ Math.imul(z, 668265263)) >>> 0;
  value = Math.imul(value ^ (value >>> 13), 1274126177) >>> 0;
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(seed: number, x: number, z: number, scale: number): number {
  const sx = x / scale,
    sz = z / scale;
  const ix = Math.floor(sx),
    iz = Math.floor(sz);
  const tx = smooth(sx - ix),
    tz = smooth(sz - iz);
  const a = hash(seed, ix, iz),
    b = hash(seed, ix + 1, iz);
  const c = hash(seed, ix, iz + 1),
    d = hash(seed, ix + 1, iz + 1);
  return a + (b - a) * tx + (c + (d - c) * tx - (a + (b - a) * tx)) * tz;
}

function rawGeography(seed: number, x: number, z: number) {
  const continentalness = valueNoise(seed ^ 0x51f15e, x, z, 1800) * 2 - 1;
  const baseElevation = 14 + continentalness * 6 + (valueNoise(seed ^ 0x11c8e, x, z, 640) * 2 - 1) * 2;
  const relief = clamp(
    valueNoise(seed ^ 0x7f4a7c15, x, z, 440) * 0.72 + valueNoise(seed ^ 0x6f2d9, x, z, 920) * 0.28,
    0,
    1,
  );
  const erosion = valueNoise(seed ^ 0x3379b1, x, z, 720);
  const ridge = Math.max(0, relief - 0.38) / 0.62;
  const terrainHeight = Math.round(
    baseElevation +
      ridge * (7 + (1 - erosion) * 12) +
      (valueNoise(seed ^ 0x42069, x, z, 84) * 2 - 1) * (1 + relief * 2),
  );
  return { continentalness, baseElevation, relief, erosion, terrainHeight };
}

function distanceToSegment(x: number, z: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax,
    dz = bz - az;
  const lengthSq = dx * dx + dz * dz;
  const t = lengthSq === 0 ? 0 : clamp(((x - ax) * dx + (z - az) * dz) / lengthSq, 0, 1);
  const px = ax + dx * t,
    pz = az + dz * t;
  return { distance: Math.hypot(x - px, z - pz), tangent: [dx, dz] as const };
}

function riverDescriptor(seed: number, cellX: number, cellZ: number): RiverDescriptor | null {
  const eligibility = hash(seed ^ 0x445a8d, cellX, cellZ);
  if (eligibility < 0.76) return null;
  const source: [number, number] = [
    Math.round((cellX + 0.12 + hash(seed ^ 0x1e35a7, cellX, cellZ) * 0.76) * RIVER_CELL),
    Math.round((cellZ + 0.12 + hash(seed ^ 0x0c5ea1, cellX, cellZ) * 0.76) * RIVER_CELL),
  ];
  let direction: [number, number] = [1, 0];
  let lowest = Infinity;
  for (let step = 0; step < 8; step += 1) {
    const angle = (step / 8) * Math.PI * 2;
    const candidateX = source[0] + Math.cos(angle) * 640;
    const candidateZ = source[1] + Math.sin(angle) * 640;
    const height = rawGeography(seed, candidateX, candidateZ).terrainHeight;
    if (height < lowest) {
      lowest = height;
      direction = [Math.cos(angle), Math.sin(angle)];
    }
  }
  const perpendicular: [number, number] = [-direction[1], direction[0]];
  const bend = (hash(seed ^ 0x118d5b, cellX, cellZ) * 2 - 1) * 34;
  const path: [number, number][] = [source];
  for (let step = 1; step <= 6; step += 1) {
    const forward = step * 112;
    const offset = Math.sin(step * 1.17 + hash(seed ^ 0x77a14, cellX, cellZ) * Math.PI * 2) * bend;
    path.push([
      Math.round(source[0] + direction[0] * forward + perpendicular[0] * offset),
      Math.round(source[1] + direction[1] * forward + perpendicular[1] * offset),
    ]);
  }
  const endpoint = path.at(-1)!;
  const waterLevel = clamp(
    Math.round(
      Math.min(rawGeography(seed, ...source).terrainHeight, rawGeography(seed, ...endpoint).terrainHeight) + 1,
    ),
    10,
    24,
  );
  return {
    id: `river:${cellX},${cellZ}`,
    source,
    path,
    width: 4 + Math.floor(hash(seed ^ 0xa5ee1, cellX, cellZ) * 5),
    waterLevel,
    direction,
  };
}

export function riverDescriptorsNear(seed: number, x: number, z: number): RiverDescriptor[] {
  const cellX = floorDiv(x, RIVER_CELL),
    cellZ = floorDiv(z, RIVER_CELL);
  const descriptors: RiverDescriptor[] = [];
  for (let dz = -1; dz <= 1; dz += 1)
    for (let dx = -1; dx <= 1; dx += 1) {
      const descriptor = riverDescriptor(seed, cellX + dx, cellZ + dz);
      if (descriptor) descriptors.push(descriptor);
    }
  return descriptors;
}

function lakeAt(seed: number, x: number, z: number): Hydrology | null {
  const cellX = floorDiv(x, LAKE_CELL),
    cellZ = floorDiv(z, LAKE_CELL);
  let closest: Hydrology | null = null;
  for (let dz = -1; dz <= 1; dz += 1)
    for (let dx = -1; dx <= 1; dx += 1) {
      const lx = cellX + dx,
        lz = cellZ + dz;
      if (hash(seed ^ 0x5bead, lx, lz) < 0.84) continue;
      const centerX = Math.round((lx + 0.18 + hash(seed ^ 0x813a2, lx, lz) * 0.64) * LAKE_CELL);
      const centerZ = Math.round((lz + 0.18 + hash(seed ^ 0x4fd9a, lx, lz) * 0.64) * LAKE_CELL);
      const center = rawGeography(seed, centerX, centerZ);
      if (center.terrainHeight > 23 || center.continentalness > 0.42) continue;
      const radiusX = 28 + hash(seed ^ 0x1029d, lx, lz) * 34;
      const radiusZ = 24 + hash(seed ^ 0x16f21, lx, lz) * 30;
      const normalized = Math.hypot((x - centerX) / radiusX, (z - centerZ) / radiusZ);
      if (normalized > 1.15) continue;
      const distance = Math.max(0, normalized - 1) * Math.max(radiusX, radiusZ);
      if (!closest || distance < closest.distance) {
        closest = {
          kind: 'lake',
          id: `lake:${lx},${lz}`,
          distance,
          water: normalized <= 1,
          waterLevel: clamp(center.terrainHeight + 1, 10, 23),
          direction: null,
        };
      }
    }
  return closest;
}

function hydrologyAt(seed: number, x: number, z: number): Hydrology {
  const lake = lakeAt(seed, x, z);
  if (lake?.water) return lake;
  let best: Hydrology | null = lake;
  for (const descriptor of riverDescriptorsNear(seed, x, z)) {
    let closestDistance = Infinity;
    let tangent: readonly [number, number] = descriptor.direction;
    for (let index = 1; index < descriptor.path.length; index += 1) {
      const previous = descriptor.path[index - 1],
        current = descriptor.path[index];
      const sample = distanceToSegment(x, z, previous[0], previous[1], current[0], current[1]);
      if (sample.distance < closestDistance) {
        closestDistance = sample.distance;
        tangent = sample.tangent;
      }
    }
    const bankWidth = descriptor.width + 4;
    if (closestDistance > bankWidth) continue;
    const length = Math.hypot(tangent[0], tangent[1]) || 1;
    const direction: [number, number] = [tangent[0] / length, tangent[1] / length];
    if (!best || closestDistance < best.distance) {
      best = {
        kind: 'river',
        id: descriptor.id,
        distance: closestDistance,
        water: closestDistance <= descriptor.width,
        waterLevel: descriptor.waterLevel,
        direction,
      };
    }
  }
  return best ?? { kind: 'dry', id: null, distance: Infinity, water: false, waterLevel: null, direction: null };
}

export function macroAt(seed: number, x: number, z: number): MacroContext {
  const geography = rawGeography(seed, x, z);
  const hydrology = hydrologyAt(seed, x, z);
  const terrainHeight =
    hydrology.kind === 'dry' || hydrology.waterLevel === null
      ? geography.terrainHeight
      : Math.min(geography.terrainHeight, hydrology.waterLevel - (hydrology.water ? 2 : 1));
  const latitude = Math.sin((z + (seed & 0xffff) * 0.17) / 2600) * 0.18;
  const temperature = clamp(
    0.62 + latitude + (valueNoise(seed ^ 0x2cae9, x, z, 1300) * 2 - 1) * 0.24 - Math.max(0, terrainHeight - 18) * 0.018,
    0,
    1,
  );
  const wetness = hydrology.kind === 'dry' ? 0 : hydrology.water ? 0.26 : 0.12;
  const humidity = clamp(
    valueNoise(seed ^ 0x88ca3, x, z, 960) * 0.72 + valueNoise(seed ^ 0x1a9d7, x, z, 300) * 0.28 + wetness,
    0,
    1,
  );
  let biome: MacroBiome = 'plains';
  if (hydrology.water || (hydrology.kind !== 'dry' && humidity > 0.58)) biome = 'wet';
  else if (temperature < 0.27) biome = 'cold';
  else if (humidity < 0.31) biome = 'dry';
  else if (geography.relief > 0.66 || terrainHeight > 29) biome = 'mountain';
  else if (humidity > 0.58) biome = 'forest';
  return {
    region: [floorDiv(x, MACRO_REGION_SIZE), floorDiv(z, MACRO_REGION_SIZE)],
    ...geography,
    terrainHeight,
    temperature,
    humidity,
    biome,
    hydrology,
  };
}

export function macroSignature(seed: number, samples: readonly (readonly [number, number])[]): string {
  let signature = 2166136261;
  for (const [x, z] of [...samples].sort(([ax, az], [bx, bz]) => ax - bx || az - bz)) {
    const context = macroAt(seed, x, z);
    const fields = [
      context.terrainHeight,
      Math.round(context.temperature * 1000),
      Math.round(context.humidity * 1000),
      Math.round(context.relief * 1000),
      context.biome,
      context.hydrology.id ?? 'dry',
    ];
    for (const field of fields.join('|')) signature = Math.imul(signature ^ field.charCodeAt(0), 16777619);
  }
  return (signature >>> 0).toString(16).padStart(8, '0');
}

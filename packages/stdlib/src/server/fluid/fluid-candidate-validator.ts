import { CHUNK_SIZE, chunkKey, floorDiv, Voxel } from '../../world/voxel';
import type {
  FluidAuthoritySnapshot,
  FluidCandidate,
  FluidCellWrite,
  FluidPosition,
  FluidReadSetEntry,
} from './fluid-transaction';

const MIN_ACTIVE_Y = 0;
const MAX_ACTIVE_Y = 63;
const REQUIRED_CANDIDATE_KEYS = [
  'protocolVersion',
  'epoch',
  'workId',
  'readSet',
  'writes',
  'consumedFrontier',
  'nextFrontier',
  'needsRescan',
] as const;
const OPTIONAL_CANDIDATE_KEYS = ['consumedCleanupFrontier', 'nextCleanupFrontier'] as const;

const positionKey = ([x, y, z]: FluidPosition) => `${x},${y},${z}`;
const positionFromKey = (key: string): FluidPosition => key.split(',').map(Number) as [number, number, number];
const neighborhood = ([x, y, z]: FluidPosition): FluidPosition[] => [
  [x, y, z],
  [x, y - 1, z],
  [x, y + 1, z],
  [x - 1, y, z],
  [x + 1, y, z],
  [x, y, z - 1],
  [x, y, z + 1],
];
const chunkKeyFor = ([x, y, z]: FluidPosition) =>
  chunkKey(floorDiv(x, CHUNK_SIZE), floorDiv(y, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE));

const isCandidatePosition = (position: FluidPosition) =>
  position.every((coordinate) => Number.isSafeInteger(coordinate)) &&
  position[1] >= MIN_ACTIVE_Y &&
  position[1] <= MAX_ACTIVE_Y;

const isPropagationCellValue = (voxel: number, fluid: number) =>
  (voxel === Voxel.Air && fluid === 0) ||
  ((voxel === Voxel.Water || voxel === Voxel.Lava) && Number.isSafeInteger(fluid) && fluid >= 1 && fluid <= 8) ||
  ((voxel === Voxel.Cobblestone || voxel === Voxel.Obsidian) && fluid === 0);

const dataRecord = (raw: unknown, required: readonly string[], optional: readonly string[] = []) => {
  if (typeof raw !== 'object' || raw === null) return null;
  const prototype = Object.getPrototypeOf(raw);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const allowed = new Set([...required, ...optional]);
  const keys = Reflect.ownKeys(raw);
  if (keys.some((key) => typeof key !== 'string' || !allowed.has(key))) return null;
  if (required.some((key) => !keys.includes(key))) return null;
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(raw, key);
    if (!descriptor || !('value' in descriptor)) return null;
    result[key as string] = descriptor.value;
  }
  return result;
};

const denseArray = <T>(raw: unknown, maximumLength: number, clone: (value: unknown) => T | null): T[] | null => {
  if (!Array.isArray(raw) || Object.getPrototypeOf(raw) !== Array.prototype) return null;
  const lengthDescriptor = Object.getOwnPropertyDescriptor(raw, 'length');
  const length = lengthDescriptor && 'value' in lengthDescriptor ? lengthDescriptor.value : -1;
  if (!Number.isSafeInteger(length) || length < 0 || length > maximumLength) return null;
  const keys = Reflect.ownKeys(raw);
  if (keys.length !== length + 1 || !keys.includes('length')) return null;
  const result: T[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(raw, String(index));
    if (!descriptor || !('value' in descriptor)) return null;
    const value = clone(descriptor.value);
    if (value === null) return null;
    result.push(value);
  }
  Object.freeze(result);
  return result;
};

const position = (raw: unknown): FluidPosition | null => {
  const coordinates = denseArray(raw, 3, (value) => (Number.isSafeInteger(value) ? (value as number) : null));
  if (!coordinates || coordinates.length !== 3) return null;
  const result: FluidPosition = [coordinates[0]!, coordinates[1]!, coordinates[2]!];
  return isCandidatePosition(result) ? Object.freeze(result) : null;
};

const readSetEntry = (raw: unknown): FluidReadSetEntry | null => {
  const value = dataRecord(raw, ['key', 'revision']);
  if (
    !value ||
    typeof value.key !== 'string' ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 0
  )
    return null;
  return Object.freeze({ key: value.key, revision: value.revision as number });
};

const cellWrite = (raw: unknown): FluidCellWrite | null => {
  const value = dataRecord(raw, ['position', 'expectedVoxel', 'expectedFluid', 'voxel', 'fluid']);
  const at = value ? position(value.position) : null;
  if (
    !value ||
    !at ||
    !Number.isSafeInteger(value.expectedVoxel) ||
    !Number.isSafeInteger(value.expectedFluid) ||
    !Number.isSafeInteger(value.voxel) ||
    !Number.isSafeInteger(value.fluid)
  )
    return null;
  return Object.freeze({
    position: at,
    expectedVoxel: value.expectedVoxel as number,
    expectedFluid: value.expectedFluid as number,
    voxel: value.voxel as number,
    fluid: value.fluid as number,
  });
};

const isBoundedUniquePositions = (
  positions: readonly FluidPosition[],
  allowed: ReadonlySet<string>,
  unique = new Set<string>(),
) => {
  for (const current of positions) {
    const key = positionKey(current);
    if (!allowed.has(key) || unique.has(key)) return false;
    unique.add(key);
  }
  return true;
};

export const fluidCandidateWorkId = (raw: unknown): string | null => {
  try {
    if (typeof raw !== 'object' || raw === null) return null;
    const prototype = Object.getPrototypeOf(raw);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const descriptor = Object.getOwnPropertyDescriptor(raw, 'workId');
    return descriptor && 'value' in descriptor && typeof descriptor.value === 'string' ? descriptor.value : null;
  } catch {
    return null;
  }
};

/** Copies the complete bounded candidate before any canonical write or queue settlement. */
export const normalizeFluidCandidateResult = (lease: FluidAuthoritySnapshot, raw: unknown): FluidCandidate | null => {
  try {
    const consumed = [...lease.frontier, ...(lease.cleanupFrontier ?? [])];
    const allowedWrites = new Set<string>();
    for (const current of consumed)
      for (const local of neighborhood(current)) if (isCandidatePosition(local)) allowedWrites.add(positionKey(local));

    const allowedNext = new Set<string>();
    for (const key of allowedWrites) {
      const current = positionFromKey(key);
      for (const local of neighborhood(current)) if (isCandidatePosition(local)) allowedNext.add(positionKey(local));
    }

    const value = dataRecord(raw, REQUIRED_CANDIDATE_KEYS, OPTIONAL_CANDIDATE_KEYS);
    if (!value) return null;
    const readSet = denseArray(value.readSet, lease.chunks.length, readSetEntry);
    const writes = denseArray(value.writes, allowedWrites.size, cellWrite);
    const consumedFrontier = denseArray(value.consumedFrontier, lease.frontier.length, position);
    const consumedCleanupFrontier = denseArray(
      value.consumedCleanupFrontier ?? [],
      lease.cleanupFrontier?.length ?? 0,
      position,
    );
    const nextFrontier = denseArray(value.nextFrontier, allowedNext.size, position);
    const nextCleanupFrontier = denseArray(value.nextCleanupFrontier ?? [], allowedNext.size, position);
    if (
      !readSet ||
      !writes ||
      !consumedFrontier ||
      !consumedCleanupFrontier ||
      !nextFrontier ||
      !nextCleanupFrontier ||
      !Number.isSafeInteger(value.protocolVersion) ||
      !Number.isSafeInteger(value.epoch) ||
      typeof value.workId !== 'string' ||
      typeof value.needsRescan !== 'boolean'
    )
      return null;

    const leasedChunks = new Set(lease.chunks.map((chunk) => chunk.key));
    const written = new Set<string>();
    for (const write of writes) {
      const key = positionKey(write.position);
      if (!allowedWrites.has(key) || written.has(key) || !leasedChunks.has(chunkKeyFor(write.position))) return null;
      if (!isPropagationCellValue(write.expectedVoxel, write.expectedFluid)) return null;
      if (!isPropagationCellValue(write.voxel, write.fluid)) return null;
      if (write.expectedVoxel === write.voxel && write.expectedFluid === write.fluid) return null;
      written.add(key);
    }
    const nextPositions = new Set<string>();
    if (
      !isBoundedUniquePositions(nextFrontier, allowedNext, nextPositions) ||
      !isBoundedUniquePositions(nextCleanupFrontier, allowedNext, nextPositions)
    )
      return null;

    return Object.freeze({
      protocolVersion: value.protocolVersion as 1,
      epoch: value.epoch as number,
      workId: value.workId,
      readSet,
      writes,
      consumedFrontier,
      consumedCleanupFrontier,
      nextFrontier,
      nextCleanupFrontier,
      needsRescan: value.needsRescan,
    });
  } catch {
    return null;
  }
};

import { CHUNK_SIZE, chunkKey, floorDiv, Voxel } from '../../world/voxel';
import type { FluidAuthoritySnapshot, FluidCandidate, FluidPosition } from './fluid-transaction';

const MIN_ACTIVE_Y = 0;
const MAX_ACTIVE_Y = 63;

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
  Array.isArray(position) &&
  position.length === 3 &&
  position.every((coordinate) => Number.isSafeInteger(coordinate)) &&
  position[1] >= MIN_ACTIVE_Y &&
  position[1] <= MAX_ACTIVE_Y;

const isKnownVoxel = (voxel: number) => Number.isSafeInteger(voxel) && voxel >= Voxel.Air && voxel <= Voxel.Lantern;

const isExistingCellValue = (voxel: number, fluid: number) => {
  if (!isKnownVoxel(voxel) || !Number.isSafeInteger(fluid)) return false;
  if (voxel !== Voxel.Water) return fluid === 0;
  const level = fluid & 0x0f;
  return level >= 1 && level <= 8 && (fluid & ~0x8f) === 0;
};

const isDerivedCellValue = (voxel: number, fluid: number) =>
  (voxel === Voxel.Air && fluid === 0) ||
  (voxel === Voxel.Water && Number.isSafeInteger(fluid) && fluid >= 1 && fluid <= 8);

const isBoundedUniquePositions = (
  positions: readonly FluidPosition[],
  allowed: ReadonlySet<string>,
  unique = new Set<string>(),
) => {
  if (!Array.isArray(positions) || positions.length > allowed.size) return false;
  for (const position of positions) {
    if (!isCandidatePosition(position)) return false;
    const key = positionKey(position);
    if (!allowed.has(key) || unique.has(key)) return false;
    unique.add(key);
  }
  return true;
};

/**
 * Validates only the bounded shape owned by the Authority. The propagation
 * algorithm remains in the compute worker; this rejects writes and follow-up
 * work that cannot have come from the leased local stencil.
 */
export const isFluidCandidateResultValid = (lease: FluidAuthoritySnapshot, candidate: FluidCandidate) => {
  const consumed = [...lease.frontier, ...(lease.cleanupFrontier ?? [])];
  const allowedWrites = new Set<string>();
  for (const position of consumed)
    for (const local of neighborhood(position)) if (isCandidatePosition(local)) allowedWrites.add(positionKey(local));

  const allowedNext = new Set<string>();
  for (const key of allowedWrites) {
    const position = positionFromKey(key);
    for (const local of neighborhood(position)) if (isCandidatePosition(local)) allowedNext.add(positionKey(local));
  }

  if (!Array.isArray(candidate.writes) || candidate.writes.length > allowedWrites.size) return false;
  const leasedChunks = new Set(lease.chunks.map((chunk) => chunk.key));
  const written = new Set<string>();
  for (const write of candidate.writes) {
    if (!write || typeof write !== 'object' || !isCandidatePosition(write.position)) return false;
    const key = positionKey(write.position);
    if (!allowedWrites.has(key) || written.has(key) || !leasedChunks.has(chunkKeyFor(write.position))) return false;
    if (!isExistingCellValue(write.expectedVoxel, write.expectedFluid)) return false;
    if (!isDerivedCellValue(write.voxel, write.fluid)) return false;
    if (write.expectedVoxel === write.voxel && write.expectedFluid === write.fluid) return false;
    written.add(key);
  }

  if (typeof candidate.needsRescan !== 'boolean') return false;
  const nextPositions = new Set<string>();
  return (
    isBoundedUniquePositions(candidate.nextFrontier, allowedNext, nextPositions) &&
    isBoundedUniquePositions(candidate.nextCleanupFrontier ?? [], allowedNext, nextPositions)
  );
};

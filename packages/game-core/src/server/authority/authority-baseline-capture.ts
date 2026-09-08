import { CHUNK_SIZE, chunkKey } from '../../world/voxel';
import type { AuthorityCollisionBaselineResult } from '../game-server-types';
import type {
  AuthorityBaselineCaptureCheckpoint,
  AuthorityBaselineCaptureEntry,
  AuthorityBaselineCaptureRequest,
  AuthorityBaselineCaptureResult,
} from './authority-baseline-capture-types';

export type AuthorityBaselineCaptureSource = Readonly<{
  generatorVersion: number;
  checkpoint(): AuthorityBaselineCaptureCheckpoint;
  readCollisionBaseline(key: string, minimumRevision: number): AuthorityCollisionBaselineResult;
}>;

export function parseAuthorityChunkKey(key: string): readonly [number, number, number] {
  const coordinates = key.split(',').map(Number);
  if (
    coordinates.length !== 3 ||
    !coordinates.every(Number.isSafeInteger) ||
    chunkKey(...(coordinates as [number, number, number])) !== key
  )
    throw new TypeError(`Authority baseline capture key is invalid: ${key}.`);
  return coordinates as [number, number, number];
}

export function assertAuthorityBaselineCaptureRequest(
  request: AuthorityBaselineCaptureRequest,
): AuthorityBaselineCaptureRequest {
  if (!Number.isSafeInteger(request.captureId) || request.captureId < 0)
    throw new RangeError('Authority baseline captureId must be a non-negative safe integer.');
  if (request.purpose !== 'mesh' && request.purpose !== 'collision-resync')
    throw new TypeError('Authority baseline capture purpose is invalid.');
  parseAuthorityChunkKey(request.key);
  if (!Number.isSafeInteger(request.minimumRevision) || request.minimumRevision < 0)
    throw new RangeError('Authority baseline minimumRevision must be a non-negative safe integer.');
  return {
    captureId: request.captureId,
    purpose: request.purpose,
    key: request.key,
    minimumRevision: request.minimumRevision,
  };
}

export function authorityBaselineCaptureKeys(request: AuthorityBaselineCaptureRequest): readonly string[] {
  const accepted = assertAuthorityBaselineCaptureRequest(request);
  if (accepted.purpose === 'collision-resync') return [accepted.key];
  const [cx, cy, cz] = parseAuthorityChunkKey(accepted.key);
  const keys: string[] = [];
  for (let dy = -1; dy <= 1; dy += 1)
    for (let dz = -1; dz <= 1; dz += 1)
      for (let dx = -1; dx <= 1; dx += 1) {
        const [x, y, z] = [cx + dx, cy + dy, cz + dz];
        if (![x, y, z].every(Number.isSafeInteger))
          throw new RangeError('Authority baseline neighborhood coordinates overflow.');
        keys.push(chunkKey(x, y, z));
      }
  return keys;
}

function checkpoint(source: AuthorityBaselineCaptureSource): AuthorityBaselineCaptureCheckpoint {
  const value = source.checkpoint();
  if (
    !value.epoch.trim() ||
    !Number.isSafeInteger(value.physicsTick) ||
    value.physicsTick < 0 ||
    !Number.isSafeInteger(value.commitSequence) ||
    value.commitSequence < 0 ||
    !Number.isSafeInteger(value.worldRevision) ||
    value.worldRevision < 0
  )
    throw new TypeError('Authority baseline checkpoint is invalid.');
  return {
    epoch: value.epoch,
    physicsTick: value.physicsTick,
    commitSequence: value.commitSequence,
    worldRevision: value.worldRevision,
  };
}

function sameCheckpoint(left: AuthorityBaselineCaptureCheckpoint, right: AuthorityBaselineCaptureCheckpoint): boolean {
  return (
    left.epoch === right.epoch &&
    left.physicsTick === right.physicsTick &&
    left.commitSequence === right.commitSequence &&
    left.worldRevision === right.worldRevision
  );
}

function unavailable(
  request: AuthorityBaselineCaptureRequest,
  captureGeneration: number,
  reason: Extract<AuthorityBaselineCaptureResult, { status: 'unavailable' }>['reason'],
): AuthorityBaselineCaptureResult {
  return {
    status: 'unavailable',
    captureId: request.captureId,
    captureGeneration,
    purpose: request.purpose,
    key: request.key,
    reason,
  };
}

export function copyAuthorityBaselineCapture(
  request: AuthorityBaselineCaptureRequest,
  captureGeneration: number,
  source: AuthorityBaselineCaptureSource,
): AuthorityBaselineCaptureResult {
  const accepted = assertAuthorityBaselineCaptureRequest(request);
  const keys = authorityBaselineCaptureKeys(accepted);
  if (!Number.isSafeInteger(captureGeneration) || captureGeneration < 0)
    throw new RangeError('Authority baseline capture generation is invalid.');
  if (!Number.isSafeInteger(source.generatorVersion) || source.generatorVersion < 1)
    throw new RangeError('Authority baseline generator version is invalid.');
  const before = checkpoint(source);
  const entries: AuthorityBaselineCaptureEntry[] = [];
  const orderedKeys =
    accepted.purpose === 'mesh' ? [accepted.key, ...keys.filter((key) => key !== accepted.key)] : keys;
  for (const key of orderedKeys) {
    const result = source.readCollisionBaseline(key, key === accepted.key ? accepted.minimumRevision : 0);
    if (result.key !== key) throw new TypeError('Authority baseline result key does not match capture key.');
    if (result.status === 'unavailable') return unavailable(accepted, captureGeneration, 'not-available');
    if (
      !Number.isSafeInteger(result.chunkRevision) ||
      result.chunkRevision < (key === accepted.key ? accepted.minimumRevision : 0) ||
      result.canonical.byteLength !== CHUNK_SIZE ** 3 * Uint16Array.BYTES_PER_ELEMENT ||
      result.fluid.byteLength !== CHUNK_SIZE ** 3
    )
      throw new TypeError('Authority baseline result is invalid.');
    entries.push({
      role: accepted.purpose === 'collision-resync' ? 'collision-resync' : key === accepted.key ? 'main' : 'overlay',
      key,
      chunkRevision: result.chunkRevision,
      generatorVersion: source.generatorVersion,
      canonical: result.canonical,
      fluid: result.fluid,
    });
  }
  const after = checkpoint(source);
  if (!sameCheckpoint(before, after)) return unavailable(accepted, captureGeneration, 'superseded');
  return {
    status: 'available',
    captureId: accepted.captureId,
    captureGeneration,
    purpose: accepted.purpose,
    key: accepted.key,
    checkpoint: before,
    entries,
  };
}

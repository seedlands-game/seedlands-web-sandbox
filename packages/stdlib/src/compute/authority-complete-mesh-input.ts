import { CHUNK_SIZE, chunkKey } from '../world/voxel';

const canonicalByteLength = CHUNK_SIZE ** 3 * Uint16Array.BYTES_PER_ELEMENT;
const fluidByteLength = CHUNK_SIZE ** 3 * Uint8Array.BYTES_PER_ELEMENT;
const overlayCount = 26;

type AuthorityCompleteOverlayInput = Readonly<{
  cx: number;
  cy: number;
  cz: number;
  voxels: ArrayBuffer;
  fluid: ArrayBuffer;
}>;

export type AuthorityCompleteMeshInput = Readonly<{
  inputStrategy: 'authority-complete';
  chunkKey: string;
  cx: number;
  cy: number;
  cz: number;
  chunkRevision: number;
  generatorVersion: number;
  haloRevision: string;
  canonical: ArrayBuffer;
  fluid: ArrayBuffer;
  overlays: readonly AuthorityCompleteOverlayInput[];
}>;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const assertNonNegativeSafeInteger = (value: unknown, name: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new TypeError(`${name} must be a non-negative safe integer.`);
  return value as number;
};

const assertPositiveSafeInteger = (value: unknown, name: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 1)
    throw new TypeError(`${name} must be a positive safe integer.`);
  return value as number;
};

const assertSafeInteger = (value: unknown, name: string): number => {
  if (!Number.isSafeInteger(value)) throw new TypeError(`${name} must be a safe integer.`);
  return value as number;
};

const assertNeighborCoordinate = (value: unknown, name: string): number => {
  if (!Number.isSafeInteger(value) || Math.abs(value as number) >= Number.MAX_SAFE_INTEGER)
    throw new TypeError(`${name} must be a safe integer with safe ±1 neighbors.`);
  return value as number;
};

const assertBuffer = (value: unknown, byteLength: number, name: string): ArrayBuffer => {
  if (!(value instanceof ArrayBuffer) || value.byteLength !== byteLength)
    throw new TypeError(`${name} must be an ArrayBuffer of ${byteLength} bytes.`);
  return value;
};

const assertDenseOverlays = (value: unknown): readonly unknown[] => {
  if (!Array.isArray(value) || value.length !== overlayCount)
    throw new TypeError(`authority-complete overlays must contain exactly ${overlayCount} entries.`);
  for (let index = 0; index < overlayCount; index += 1)
    if (!Object.hasOwn(value, index)) throw new TypeError('authority-complete overlays must be dense.');
  return value;
};

export function validateAuthorityCompleteMeshInput(value: unknown): AuthorityCompleteMeshInput {
  if (!isRecord(value) || value.inputStrategy !== 'authority-complete')
    throw new TypeError('Expected authority-complete mesh input strategy.');
  const cx = assertNeighborCoordinate(value.cx, 'cx');
  const cy = assertNeighborCoordinate(value.cy, 'cy');
  const cz = assertNeighborCoordinate(value.cz, 'cz');
  const expectedKey = chunkKey(cx, cy, cz);
  if (value.chunkKey !== expectedKey) throw new TypeError(`Chunk key must equal ${expectedKey}.`);
  const chunkRevision = assertNonNegativeSafeInteger(value.chunkRevision, 'chunkRevision');
  const generatorVersion = assertPositiveSafeInteger(value.generatorVersion, 'generatorVersion');
  if (typeof value.haloRevision !== 'string' || value.haloRevision.trim().length === 0)
    throw new TypeError('authority-complete haloRevision must be non-empty.');
  const canonical = assertBuffer(value.canonical, canonicalByteLength, 'canonical');
  const fluid = assertBuffer(value.fluid, fluidByteLength, 'fluid');
  const buffers = new Set<ArrayBuffer>([canonical, fluid]);
  const expectedKeys = new Set<string>();
  for (let dy = -1; dy <= 1; dy += 1)
    for (let dz = -1; dz <= 1; dz += 1)
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0 && dz === 0) continue;
        expectedKeys.add(chunkKey(cx + dx, cy + dy, cz + dz));
      }
  const overlays = assertDenseOverlays(value.overlays).map((candidate, index) => {
    if (!isRecord(candidate)) throw new TypeError(`overlay ${index} must be an object.`);
    const overlayCx = assertSafeInteger(candidate.cx, `overlay ${index} cx`);
    const overlayCy = assertSafeInteger(candidate.cy, `overlay ${index} cy`);
    const overlayCz = assertSafeInteger(candidate.cz, `overlay ${index} cz`);
    const key = chunkKey(overlayCx, overlayCy, overlayCz);
    if (!expectedKeys.delete(key)) throw new TypeError(`overlay ${index} has an unexpected or duplicate coordinate.`);
    const voxels = assertBuffer(candidate.voxels, canonicalByteLength, `overlay ${index} voxels`);
    const overlayFluid = assertBuffer(candidate.fluid, fluidByteLength, `overlay ${index} fluid`);
    if (buffers.has(voxels) || buffers.has(overlayFluid))
      throw new TypeError(`overlay ${index} block buffer must not alias another complete input block.`);
    buffers.add(voxels);
    buffers.add(overlayFluid);
    return { cx: overlayCx, cy: overlayCy, cz: overlayCz, voxels, fluid: overlayFluid };
  });
  if (expectedKeys.size !== 0) throw new TypeError('authority-complete overlays are incomplete.');
  return {
    inputStrategy: 'authority-complete',
    chunkKey: expectedKey,
    cx,
    cy,
    cz,
    chunkRevision,
    generatorVersion,
    haloRevision: value.haloRevision,
    canonical,
    fluid,
    overlays,
  };
}

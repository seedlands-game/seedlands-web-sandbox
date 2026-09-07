import type { ChunkSnapshot } from '../../server/persistence/chunk-persistence';
import { CHUNK_SIZE, chunkKey } from '../../world/voxel';

type LoadResult =
  | { status: 'missing' }
  | {
      status: 'found';
      key: string;
      cx: number;
      cy: number;
      cz: number;
      revision: number;
      codec: string;
      recordBytes: number;
      decodeMs: number;
      voxels: ArrayBuffer;
      fluidVersion?: 1;
      fluid?: ArrayBuffer;
    };

export type PreparedBrowserLoadResult =
  | { status: 'missing'; key: string }
  | {
      status: 'found';
      key: string;
      snapshot: ChunkSnapshot;
      codec: string;
      recordBytes: number;
      decodeMs: number;
    };

export function prepareBrowserLoadResult(
  seedText: string,
  generatorVersion: number,
  cx: number,
  cy: number,
  cz: number,
  value: unknown,
): PreparedBrowserLoadResult {
  const key = chunkKey(cx, cy, cz);
  if (!value || typeof value !== 'object') throw new Error(`Persistence load result is invalid for ${key}.`);
  const result = value as Partial<LoadResult>;
  if (result.status === 'missing') return { status: 'missing', key };
  if (result.status !== 'found') throw new Error(`Persistence load result is invalid for ${key}.`);
  if (result.key !== key || result.cx !== cx || result.cy !== cy || result.cz !== cz)
    throw new Error(`Persistence load result does not match ${key}.`);
  if (!Number.isInteger(result.revision) || result.revision! < 0)
    throw new Error(`Persistence load revision is invalid for ${key}.`);
  if (typeof result.codec !== 'string' || !result.codec.length)
    throw new Error(`Persistence load codec is invalid for ${key}.`);
  if (
    !Number.isFinite(result.recordBytes) ||
    result.recordBytes! < 0 ||
    !Number.isFinite(result.decodeMs) ||
    result.decodeMs! < 0
  )
    throw new Error(`Persistence load metrics are invalid for ${key}.`);
  if (
    !(result.voxels instanceof ArrayBuffer) ||
    result.voxels.byteLength !== CHUNK_SIZE ** 3 * Uint16Array.BYTES_PER_ELEMENT
  )
    throw new Error(`Persistence load voxels are invalid for ${key}.`);
  if (
    (result.fluid !== undefined || result.fluidVersion !== undefined) &&
    (result.fluidVersion !== 1 || !(result.fluid instanceof ArrayBuffer) || result.fluid.byteLength !== CHUNK_SIZE ** 3)
  )
    throw new Error(`Persistence load fluid is invalid for ${key}.`);
  return {
    status: 'found',
    key,
    codec: result.codec,
    recordBytes: result.recordBytes!,
    decodeMs: result.decodeMs!,
    snapshot: {
      key,
      seedText,
      cx,
      cy,
      cz,
      generatorVersion,
      revision: result.revision!,
      voxels: new Uint16Array(result.voxels),
      ...(result.fluid ? { fluidVersion: 1, fluid: new Uint8Array(result.fluid) } : {}),
    },
  };
}

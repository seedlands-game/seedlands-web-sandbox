import { CHUNK_SIZE, chunkKey } from '@seedlands/stdlib/world/voxel';
import type { AuthorityCollisionBaselinePayload } from './authority-collision-baseline-client';

export type SkySourceChunk = Readonly<{ canonical: Uint16Array; revision: number }>;

/** Exclusive transferred copy for one proof, without adding a collision/mesh cache entry. */
export async function requestBrowserSkyChunk(
  request: (payload: Record<string, unknown>) => Promise<unknown>,
  epoch: () => string,
  cx: number,
  cy: number,
  cz: number,
  revision: number,
): Promise<SkySourceChunk | null> {
  if (![cx, cy, cz, revision].every(Number.isSafeInteger) || revision < 0)
    throw new TypeError('Sky source chunk coordinates or revision are invalid.');
  const submittedEpoch = epoch();
  const key = chunkKey(cx, cy, cz);
  const payload = (await request({
    kind: 'request-sky-source',
    key,
    minimumRevision: revision,
  })) as AuthorityCollisionBaselinePayload;
  if (
    epoch() !== submittedEpoch ||
    !payload ||
    payload.status !== 'available' ||
    payload.key !== key ||
    payload.chunkRevision !== revision ||
    !(payload.canonical instanceof ArrayBuffer) ||
    payload.canonical.byteLength !== CHUNK_SIZE ** 3 * 2 ||
    !(payload.fluid instanceof ArrayBuffer) ||
    payload.fluid.byteLength !== CHUNK_SIZE ** 3
  )
    return null;
  return { canonical: new Uint16Array(payload.canonical), revision: payload.chunkRevision };
}

import { CHUNK_SIZE, chunkKey, floorDiv, mod, voxelIndex } from '@seedlands/stdlib/world/voxel';
import type { SkySourceChunk } from '../../client/authority/browser-authority-sky-chunk';
import type { SkyColumnSource, SkyVoxelReader } from './sky-column-source';
import { SKY_VISIBILITY_MAX_COLUMN_HEIGHT } from './sky-visibility-volume';

type ReadChunk = (cx: number, cy: number, cz: number, revision: number) => Promise<SkySourceChunk | null>;

/** At most sixteen exclusive canonical copies; all are released after this one column proof. */
export async function prepareSkyColumnReader(
  source: SkyColumnSource,
  chunk: readonly [number, number, number],
  reader: SkyVoxelReader,
  readChunk: ReadChunk | undefined,
  isCurrent: () => boolean,
): Promise<SkyVoxelReader | null> {
  if (
    !isCurrent() ||
    source.status !== 'complete' ||
    source.cx !== chunk[0] ||
    source.cz !== chunk[2] ||
    !chunk.every(Number.isSafeInteger) ||
    !Number.isSafeInteger(source.generatedEmptyAboveY) ||
    source.entries.length > 128
  )
    return null;
  const [cx, cy, cz] = chunk;
  const rows = new Map<string, (typeof source.entries)[number]>();
  let ceiling = Math.max(cy * CHUNK_SIZE + CHUNK_SIZE - 1, source.generatedEmptyAboveY);
  for (const row of source.entries) {
    if (
      row.cx !== cx ||
      row.cz !== cz ||
      ![row.cy, row.revision].every(Number.isSafeInteger) ||
      row.revision < 0 ||
      row.key !== chunkKey(cx, row.cy, cz) ||
      rows.has(row.key)
    )
      return null;
    rows.set(row.key, row);
    if (row.cy >= cy) ceiling = Math.max(ceiling, row.cy * CHUNK_SIZE + CHUNK_SIZE - 1);
  }
  if (
    ![cx * CHUNK_SIZE, cx * CHUNK_SIZE + 31, cy * CHUNK_SIZE, ceiling, cz * CHUNK_SIZE, cz * CHUNK_SIZE + 31].every(
      Number.isSafeInteger,
    ) ||
    ceiling - cy * CHUNK_SIZE + 1 > SKY_VISIBILITY_MAX_COLUMN_HEIGHT
  )
    return null;
  const copies = new Map<string, SkySourceChunk>();
  for (let y = cy; y <= floorDiv(ceiling, CHUNK_SIZE); y++) {
    const key = chunkKey(cx, y, cz),
      row = rows.get(key);
    const needed = y * CHUNK_SIZE <= source.generatedEmptyAboveY || Boolean(row) || y === cy;
    if (!needed || reader.getChunkRevision(cx, y, cz) !== null) continue;
    if (!readChunk || !isCurrent()) return null;
    const copy = await readChunk(cx, y, cz, row?.revision ?? 0);
    if (!isCurrent() || !copy || copy.revision !== (row?.revision ?? 0) || copy.canonical.length !== CHUNK_SIZE ** 3)
      return null;
    copies.set(key, copy);
  }
  return {
    voxelSemantics: reader.voxelSemantics,
    getChunkRevision: (x, y, z) => reader.getChunkRevision(x, y, z) ?? copies.get(chunkKey(x, y, z))?.revision ?? null,
    getVoxel: (x, y, z) => {
      const key = chunkKey(floorDiv(x, CHUNK_SIZE), floorDiv(y, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE));
      const copy = copies.get(key);
      return copy
        ? copy.canonical[voxelIndex(mod(x, CHUNK_SIZE), mod(y, CHUNK_SIZE), mod(z, CHUNK_SIZE))]!
        : reader.getVoxel(x, y, z);
    },
  };
}

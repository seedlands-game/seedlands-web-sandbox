import type { ChunkColumnDirectory } from '@seedlands/stdlib/server/persistence/chunk-persistence';
import { chunkKey } from '@seedlands/stdlib/world/voxel';

export async function inspectBrowserColumnDirectory(
  cx: number,
  cz: number,
  observer: Readonly<{ source(): string; fence(): unknown; request(): Promise<unknown> }>,
): Promise<ChunkColumnDirectory> {
  if (!Number.isSafeInteger(cx) || !Number.isSafeInteger(cz)) throw new RangeError('Column coordinates are invalid.');
  const before = observer.source();
  const fence = observer.fence();
  const result = await observer.request();
  if (before !== observer.source() || fence !== observer.fence()) return { status: 'unknown', reason: 'superseded' };
  return parseBrowserColumnDirectory(result, cx, cz);
}

export function parseBrowserColumnDirectory(value: unknown, cx: number, cz: number): ChunkColumnDirectory {
  const invalid = (): ChunkColumnDirectory => ({ status: 'unknown', reason: 'invalid-data' });
  if (!value || typeof value !== 'object') return invalid();
  const result = value as Partial<ChunkColumnDirectory>;
  if (result.status === 'unknown') {
    return Object.keys(value).length === 2 &&
      ['source-unavailable', 'invalid-data', 'budget-exhausted', 'superseded'].includes(result.reason ?? '')
      ? { status: 'unknown', reason: result.reason! }
      : invalid();
  }
  if (
    result.status !== 'complete' ||
    Object.keys(value).length !== 3 ||
    !Number.isSafeInteger(result.revision) ||
    result.revision! < 0 ||
    !Array.isArray(result.entries) ||
    result.entries.length > 128
  )
    return invalid();
  const keys = new Set<string>();
  const entries = [];
  for (const entry of result.entries) {
    if (
      !entry ||
      typeof entry !== 'object' ||
      !Number.isSafeInteger(entry.cy) ||
      entry.cx !== cx ||
      entry.cz !== cz ||
      entry.key !== chunkKey(cx, entry.cy, cz) ||
      !Number.isSafeInteger(entry.revision) ||
      entry.revision < 0 ||
      keys.has(entry.key)
    )
      return invalid();
    keys.add(entry.key);
    entries.push({ cx, cy: entry.cy, cz, key: entry.key, revision: entry.revision });
  }
  return { status: 'complete', revision: result.revision!, entries };
}

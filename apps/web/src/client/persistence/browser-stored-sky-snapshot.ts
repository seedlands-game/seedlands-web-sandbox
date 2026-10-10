import type { ChunkSnapshot } from '@seedlands/stdlib/server/persistence/chunk-persistence';
import { cloneBrowserChunkSnapshot, prepareBrowserLoadResult } from './browser-persistence-load';

/** A durable read for one proof; it never touches the prepared load registry or cache. */
export async function readBrowserStoredSkySnapshot(
  cx: number,
  cy: number,
  cz: number,
  revision: number,
  observer: Readonly<{
    seedText: string;
    generatorVersion: number;
    source(): string;
    fence(): unknown;
    request(): Promise<unknown>;
  }>,
): Promise<ChunkSnapshot | null> {
  if (![cx, cy, cz, revision].every(Number.isSafeInteger) || revision < 0)
    throw new RangeError('Stored Sky source coordinates or revision are invalid.');
  const source = observer.source(),
    fence = observer.fence();
  if (fence === null) return null;
  const value = await observer.request();
  if (source !== observer.source() || fence !== observer.fence()) return null;
  const prepared = prepareBrowserLoadResult(observer.seedText, observer.generatorVersion, cx, cy, cz, value);
  return prepared.status === 'found' && prepared.snapshot.revision === revision
    ? cloneBrowserChunkSnapshot(prepared.snapshot)
    : null;
}

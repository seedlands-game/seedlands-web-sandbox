import { inspectBrowserColumnDirectory } from './browser-column-directory';
import { readBrowserStoredSkySnapshot } from './browser-stored-sky-snapshot';

/** Nonconsuming reads share the current store identity and save/disposal fence. */
export function createBrowserPersistenceSourceReads(
  owner: Readonly<{ worldId: string; seedText: string; generatorVersion: number; worldgenProvider: unknown }>,
  fence: () => unknown,
  request: (payload: Record<string, unknown>) => Promise<unknown>,
) {
  const source = () => JSON.stringify([owner.worldId, owner.seedText, owner.generatorVersion, owner.worldgenProvider]);
  return {
    inspectColumnDirectory: (cx: number, cz: number) =>
      inspectBrowserColumnDirectory(cx, cz, {
        source,
        fence,
        request: () => request({ kind: 'column-directory', cx, cz }),
      }),
    readStoredSkySnapshot: (cx: number, cy: number, cz: number, revision: number) =>
      readBrowserStoredSkySnapshot(cx, cy, cz, revision, {
        seedText: owner.seedText,
        generatorVersion: owner.generatorVersion,
        source,
        fence,
        request: () => request({ kind: 'load', cx, cy, cz }),
      }),
  };
}

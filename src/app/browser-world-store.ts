import { decodeBrowserWorldSave } from '../client/browser-chunk-persistence';
import { decodeWorldSave } from '../world/storage';
import type { RestoredSession } from './app-contracts';

const STORAGE_KEY = 'seedlands-world-v2';

export class BrowserWorldStore {
  load(): RestoredSession | null {
    const raw = localStorage.getItem(STORAGE_KEY);
    const current = decodeBrowserWorldSave(raw);
    if (current)
      return {
        player: current.player,
        seed: current.seed,
        legacySnapshots: current.snapshots,
        changes: [],
      };
    const legacy = decodeWorldSave(raw);
    return legacy
      ? {
          player: legacy.player,
          seed: legacy.seed,
          legacySnapshots: [],
          changes: legacy.changes,
        }
      : null;
  }
}

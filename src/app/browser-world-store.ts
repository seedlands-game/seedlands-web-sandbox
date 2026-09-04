import type * as pc from 'playcanvas';
import { BrowserChunkPersistence, decodeBrowserWorldSave } from '../client/browser-chunk-persistence';
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
        persistence: new BrowserChunkPersistence(current.snapshots),
        changes: [],
      };
    const legacy = decodeWorldSave(raw);
    return legacy
      ? {
          player: legacy.player,
          seed: legacy.seed,
          persistence: new BrowserChunkPersistence(),
          changes: legacy.changes,
        }
      : null;
  }

  save(seed: string, player: pc.Vec3, persistence: BrowserChunkPersistence) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persistence.serialize(seed, [player.x, player.y, player.z])));
  }
}

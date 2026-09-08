import { describe, expect, it } from 'vitest';
import { World } from '../../apps/web/src/app/world/world-runtime';

describe('remote initial playable area barrier', () => {
  it('uses the player height and accepts a completed empty mesh as ready', async () => {
    const chunks = new Map([['0,1,0', { task: { chunkRevision: 4 }, triangles: 0 }]]);
    const wait = World.prototype.waitForInitialPlayableArea as unknown as (
      this: Readonly<{
        repository: { waitForFirstVisible(): Promise<void>; chunks: typeof chunks };
        disposed: boolean;
      }>,
      position: Readonly<{ x: number; y: number; z: number }>,
      radius: number,
    ) => Promise<void>;
    const world = { repository: { waitForFirstVisible: async () => undefined, chunks }, disposed: false };

    await expect(wait.call(world, { x: 0.5, y: 40, z: 0.5 }, 0)).resolves.toBeUndefined();
  });
});

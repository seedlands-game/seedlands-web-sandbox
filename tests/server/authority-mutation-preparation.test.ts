import { describe, expect, it, vi } from 'vitest';
import { AuthorityRuntime } from '../../src/server/authority/authority-runtime';
import type { ChunkPersistence, ChunkSnapshot } from '../../src/server/persistence/chunk-persistence';
import { Voxel, chunkKey } from '../../src/world/voxel';

const cloneSnapshot = (snapshot: ChunkSnapshot): ChunkSnapshot => ({
  ...snapshot,
  voxels: snapshot.voxels.slice(),
  ...(snapshot.fluid ? { fluid: snapshot.fluid.slice() } : {}),
});

class AsyncCachePersistence implements ChunkPersistence {
  private readonly durable = new Map<string, ChunkSnapshot>();
  private readonly cache = new Map<string, ChunkSnapshot>();

  loadSnapshot(key: string): ChunkSnapshot | null {
    const snapshot = this.cache.get(key);
    this.cache.delete(key);
    return snapshot ? cloneSnapshot(snapshot) : null;
  }

  saveSnapshots(snapshots: readonly ChunkSnapshot[]): void {
    snapshots.forEach((snapshot) => {
      this.durable.set(snapshot.key, cloneSnapshot(snapshot));
      this.cache.set(snapshot.key, cloneSnapshot(snapshot));
    });
  }

  async ensureNeighborhood(cx: number, cy: number, cz: number): Promise<void> {
    for (let y = cy - 1; y <= cy + 1; y += 1)
      for (let z = cz - 1; z <= cz + 1; z += 1)
        for (let x = cx - 1; x <= cx + 1; x += 1) {
          const key = chunkKey(x, y, z);
          const snapshot = this.durable.get(key);
          if (snapshot) this.cache.set(key, cloneSnapshot(snapshot));
        }
  }

  evictSnapshot(key: string): void {
    this.cache.delete(key);
  }
}

const canonical = (runtime: AuthorityRuntime, cx: number, cy: number, cz: number) => ({
  key: chunkKey(cx, cy, cz),
  cx,
  cy,
  cz,
  chunkRevision: 0,
  generatorVersion: runtime.server.generatorVersion,
  canonical: new Uint16Array(32 ** 3),
});

describe('Authority mutation asynchronous Chunk preparation', () => {
  it('远端World edit先请求General生成且等待接纳，Authority物理在准备期间继续推进', async () => {
    const requests: string[] = [];
    const runtime = await AuthorityRuntime.create({
      epoch: 'mutation-preparation:1',
      seedText: 'mutation-preparation',
      initialWorldTime: 9,
      startTimeMs: 0,
      initialPlayerBodyPosition: [0.5, 33, 0.5],
      onUnknownChunk: (key) => requests.push(key),
    });
    const beforeTick = runtime.ready().snapshot.physicsTick;

    const editing = runtime.editWorld('player-edit', [{ x: 2_048, y: 32, z: 0, value: Voxel.Stone }]);
    await vi.waitFor(() => expect(requests).toEqual(['64,1,0']));
    expect(runtime.server.canonicalResidencyDiagnostics.residentCount).toBe(0);
    expect(runtime.wake(100).physicsTick).toBeGreaterThan(beforeTick);

    expect(runtime.acceptGeneratedChunk(canonical(runtime, 64, 1, 0))).toBe(true);
    await expect(editing).resolves.toMatchObject({ committed: true });
    expect(runtime.server.peekLoadedVoxel(2_048, 32, 0)?.voxel).toBe(Voxel.Stone);
  });

  it('已保存Chunk驱逐后direct edit先异步回载，旧编辑不会被procedural覆盖', async () => {
    const persistence = new AsyncCachePersistence();
    const unknown = vi.fn();
    const runtime = await AuthorityRuntime.create({
      epoch: 'mutation-preparation:2',
      seedText: 'mutation-preparation-saved',
      persistence,
      initialWorldTime: 9,
      startTimeMs: 0,
      initialPlayerBodyPosition: [0.5, 33, 0.5],
      onUnknownChunk: unknown,
    });
    expect(runtime.acceptGeneratedChunk(canonical(runtime, 0, 0, 0))).toBe(true);
    await expect(runtime.editWorld('first-edit', [{ x: 1, y: 1, z: 1, value: Voxel.Stone }])).resolves.toMatchObject({
      committed: true,
    });
    await runtime.save();
    expect(await runtime.server.evictChunk(0, 0, 0)).toBe(true);
    expect(runtime.server.canonicalResidencyDiagnostics.residentCount).toBe(0);

    await expect(runtime.editWorld('second-edit', [{ x: 2, y: 1, z: 1, value: Voxel.Wood }])).resolves.toMatchObject({
      committed: true,
    });
    expect(runtime.server.peekLoadedVoxel(1, 1, 1)?.voxel).toBe(Voxel.Stone);
    expect(runtime.server.peekLoadedVoxel(2, 1, 1)?.voxel).toBe(Voxel.Wood);
    expect(unknown).not.toHaveBeenCalled();
  });

  it('远端set-block命令复用同一准备门，不在Authority热路径同步生成', async () => {
    const requests: string[] = [];
    const runtime = await AuthorityRuntime.create({
      epoch: 'mutation-preparation:3',
      seedText: 'mutation-preparation-command',
      initialWorldTime: 9,
      startTimeMs: 0,
      initialPlayerBodyPosition: [0.5, 33, 0.5],
      onUnknownChunk: (key) => requests.push(key),
    });
    const executing = runtime.executeCommand(
      { actorId: 'developer', sourceType: 'local-developer', capabilities: ['mutation'] },
      { type: 'set-block', position: [2_080, 32, 0], voxel: Voxel.Wood },
    );
    await vi.waitFor(() => expect(requests).toEqual(['65,1,0']));
    expect(runtime.server.canonicalResidencyDiagnostics.residentCount).toBe(0);
    expect(runtime.acceptGeneratedChunk(canonical(runtime, 65, 1, 0))).toBe(true);

    await expect(executing).resolves.toMatchObject({ success: true });
    expect(runtime.server.peekLoadedVoxel(2_080, 32, 0)?.voxel).toBe(Voxel.Wood);
  });
});

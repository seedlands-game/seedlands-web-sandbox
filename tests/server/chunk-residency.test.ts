import { describe, expect, it, vi } from 'vitest';
import { AuthorityRuntime } from '../../src/server/authority/authority-runtime';
import { canonicalResidencyRetryDelayMs } from '../../src/server/authority/authority-residency-runtime';
import { CanonicalChunkResidency, type CanonicalResidencyChunk } from '../../src/server/chunk-residency';
import { GameServer } from '../../src/server/game-server';
import { MemoryGamePersistence } from '../../src/server/persistence/memory-game-persistence';
import { Voxel } from '../../src/world/voxel';

const chunk = (key: string, accessEpoch: number, revision = 0): CanonicalResidencyChunk => ({
  key,
  accessEpoch,
  revision,
  persistedRevision: revision,
  dirty: false,
});

describe('Canonical Chunk residency', () => {
  it('保存失败退避按1/2/4秒增长并在30秒封顶', () => {
    expect([1, 2, 3, 4, 5, 6, 20].map(canonicalResidencyRetryDelayMs)).toEqual([
      1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000,
    ]);
  });

  it('按accessEpoch有限批回收clean LRU并保留所有pin', () => {
    const residency = new CanonicalChunkResidency({ target: 4, hardLimit: 8, evictionBatch: 2 });
    const chunks = new Map(Array.from({ length: 10 }, (_, index) => [`${index},0,0`, chunk(`${index},0,0`, index)]));
    residency.replacePins('streaming', ['0,0,0']);
    residency.replacePins('physics', ['1,0,0']);
    residency.replacePins('fluid', ['2,0,0']);

    const first = residency.planEvictions(chunks);
    expect(first.map(({ key }) => key)).toEqual(['3,0,0', '4,0,0']);
    first.forEach((candidate) => {
      expect(residency.isEvictionStillValid(chunks, candidate)).toBe(true);
      chunks.delete(candidate.key);
      residency.recordEviction();
    });
    expect(residency.planEvictions(chunks)).toHaveLength(2);
    expect(residency.diagnostics(chunks)).toMatchObject({
      residentCount: 8,
      target: 4,
      pinnedCount: 3,
      dirtyCount: 0,
      evictionCount: 2,
      oversubscribed: true,
    });
  });

  it('mesh租赁按exact key引用计数，旧release不能解除同key的新prepare', () => {
    const residency = new CanonicalChunkResidency({ target: 1, hardLimit: 4, evictionBatch: 4 });
    const chunks = new Map([
      ['0,0,0', chunk('0,0,0', 0)],
      ['1,0,0', chunk('1,0,0', 1)],
    ]);
    residency.retainMesh('0,0,0');
    residency.retainMesh('0,0,0');
    residency.releaseMesh('0,0,0');

    expect(residency.planEvictions(chunks).map(({ key }) => key)).toEqual(['1,0,0']);
    residency.releaseMesh('0,0,0');
    expect(residency.planEvictions(chunks).map(({ key }) => key)).toEqual(['0,0,0']);
  });

  it('删除前二次核对对象、accessEpoch、revision、dirty与pin', () => {
    const residency = new CanonicalChunkResidency({ target: 0, hardLimit: 4, evictionBatch: 4 });
    const current = chunk('0,0,0', 1);
    const chunks = new Map([['0,0,0', current]]);
    const candidate = residency.planEvictions(chunks)[0];

    current.accessEpoch += 1;
    expect(residency.isEvictionStillValid(chunks, candidate)).toBe(false);
    current.accessEpoch -= 1;
    current.revision += 1;
    expect(residency.isEvictionStillValid(chunks, candidate)).toBe(false);
    current.revision -= 1;
    current.dirty = true;
    expect(residency.isEvictionStillValid(chunks, candidate)).toBe(false);
    current.dirty = false;
    residency.replacePins('physics', ['0,0,0']);
    expect(residency.isEvictionStillValid(chunks, candidate)).toBe(false);
  });

  it('到hardLimit且全部dirty或pin时只拒绝新增admission并保留现有数据', () => {
    const residency = new CanonicalChunkResidency({ target: 2, hardLimit: 4, evictionBatch: 2 });
    const chunks = new Map(
      Array.from({ length: 4 }, (_, index) => {
        const value = chunk(`${index},0,0`, index);
        value.dirty = true;
        return [value.key, value] as const;
      }),
    );

    expect(residency.canAdmit(chunks, '4,0,0')).toBe(false);
    residency.recordRejectedAdmission();
    expect(chunks).toHaveLength(4);
    expect(residency.diagnostics(chunks)).toMatchObject({ rejectedAdmissionCount: 1, dirtyCount: 4 });
  });
});

describe('GameServer canonical residency integration', () => {
  it('只驱逐已ACK的clean Chunk，dirty在原子保存失败时完整保留并可重试', async () => {
    const persistence = new MemoryGamePersistence();
    const runtime = await AuthorityRuntime.create({
      epoch: 'residency:1',
      seedText: 'canonical-residency',
      persistence,
      initialWorldTime: 9,
      startTimeMs: 0,
      initialPlayerBodyPosition: [0.5, 33, 0.5],
      canonicalResidency: { target: 4, hardLimit: 8, evictionBatch: 2 },
    });
    for (let cx = 0; cx < 6; cx += 1)
      expect(
        (await runtime.editWorld('residency-test', [{ x: cx * 32, y: 63, z: 0, value: Voxel.Lantern }])).committed,
      ).toBe(true);
    persistence.failNextFrozenSave(new Error('residency checkpoint failed'));

    runtime.wake(20);
    await vi.waitFor(() => expect(runtime.residencyDiagnostics.autoSaveFailureCount).toBe(1));
    expect(runtime.server.canonicalResidencyDiagnostics).toMatchObject({ residentCount: 6, dirtyCount: 6 });
    expect(runtime.residencyDiagnostics.lastSaveError).toContain('residency checkpoint failed');

    runtime.wake(500);
    expect(runtime.residencyDiagnostics.autoSaveFailureCount).toBe(1);
    runtime.wake(1_100);
    await vi.waitFor(() => expect(runtime.server.canonicalResidencyDiagnostics.dirtyCount).toBe(0));
    runtime.server.maintainCanonicalResidency();
    expect(runtime.server.canonicalResidencyDiagnostics.residentCount).toBeLessThanOrEqual(4);
  });

  it('GameServer在默认配置下让超过256个已释放clean Chunk收敛且不误删邻居pin', () => {
    const server = new GameServer({ seedText: 'canonical-long-traverse' });
    server.setFluidActiveChunks(['0,0,0']);
    for (let cx = 0; cx < 300; cx += 1) {
      const canonical = new Uint16Array(32 ** 3);
      expect(
        server.acceptWorkerCanonical({
          key: `${cx},0,0`,
          cx,
          cy: 0,
          cz: 0,
          chunkRevision: 0,
          generatorVersion: server.generatorVersion,
          canonical,
        }),
      ).toBe(true);
    }
    while (server.maintainCanonicalResidency() > 0) {
      // 每轮都受固定batch限制，重复模拟后续Authority wake。
    }

    expect(server.canonicalResidencyDiagnostics.residentCount).toBeLessThanOrEqual(256);
    expect(server.peekLoadedVoxel(0, 0, 0)).not.toBeNull();
  });
});

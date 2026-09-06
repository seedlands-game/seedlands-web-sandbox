import { describe, expect, it, vi } from 'vitest';
import { AuthorityRuntime } from '../../src/server/authority/authority-runtime';
import { CHUNK_SIZE, Voxel } from '../../src/world/voxel';

describe('Authority collision baseline read port', () => {
  it('只复制已驻留且达到最低revision的canonical，不触发加载、生成或pin', async () => {
    const unknown = vi.fn();
    const runtime = await AuthorityRuntime.create({
      epoch: 'collision-baseline:1',
      seedText: 'collision-baseline',
      initialWorldTime: 9,
      startTimeMs: 0,
      initialPlayerBodyPosition: [0.5, 33, 0.5],
      onUnknownChunk: unknown,
    });

    expect(runtime.readCollisionBaseline('0,0,0', 0)).toEqual({ status: 'unavailable', key: '0,0,0' });
    expect(runtime.server.canonicalResidencyDiagnostics.residentCount).toBe(0);
    expect(unknown).not.toHaveBeenCalled();

    const canonical = new Uint16Array(CHUNK_SIZE ** 3);
    canonical[0] = Voxel.Stone;
    expect(
      runtime.acceptGeneratedChunk({
        key: '0,0,0',
        cx: 0,
        cy: 0,
        cz: 0,
        chunkRevision: 0,
        generatorVersion: runtime.server.generatorVersion,
        canonical,
      }),
    ).toBe(true);
    expect(runtime.readCollisionBaseline('0,0,0', 1)).toEqual({ status: 'unavailable', key: '0,0,0' });

    const baseline = runtime.readCollisionBaseline('0,0,0', 0);
    expect(baseline).toMatchObject({ status: 'available', key: '0,0,0', chunkRevision: 0 });
    if (baseline.status !== 'available') throw new Error('Collision baseline should be available.');
    expect(new Uint16Array(baseline.canonical)[0]).toBe(Voxel.Stone);
    expect(new Uint8Array(baseline.fluid)).toHaveLength(CHUNK_SIZE ** 3);
    new Uint16Array(baseline.canonical)[0] = Voxel.Air;
    const second = runtime.readCollisionBaseline('0,0,0', 0);
    if (second.status !== 'available') throw new Error('Collision baseline should remain available.');
    expect(new Uint16Array(second.canonical)[0]).toBe(Voxel.Stone);
  });
});

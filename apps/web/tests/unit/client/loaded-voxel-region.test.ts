import { describe, expect, it, vi } from 'vitest';
import { CHUNK_SIZE, voxelIndex } from '@seedlands/stdlib/world/voxel';
import { AuthorityCollisionBaselineClient } from '../../../src/client/authority/authority-collision-baseline-client';
import { AuthorityCollisionRevisionGuard } from '../../../src/client/authority/authority-collision-mirror';
import { copyLoadedVoxelRegion, sampleLoadedVoxelRegion } from '../../../src/client/authority/loaded-voxel-region';

describe('detached loaded voxel regions', () => {
  it('guards each of the 27 halo chunks once instead of querying every cell', () => {
    const read = vi.fn(() => null);
    const region = copyLoadedVoxelRegion([-16, -16, -16], 64, read);
    expect(read).toHaveBeenCalledTimes(27);
    expect(new Set(read.mock.calls.map((v) => v.join(','))).size).toBe(27);
    expect(region.voxels.byteLength + region.loaded.byteLength).toBe(64 ** 3 * 3);
    expect(region.loaded.every((v) => v === 0)).toBe(true);
  });

  it('keeps negative coordinates, x/y/z order, loaded air and unknown distinct without owner aliases', () => {
    const canonical = new Uint16Array(CHUNK_SIZE ** 3);
    canonical[voxelIndex(31, 31, 31)] = 7;
    const region = copyLoadedVoxelRegion([-2, -2, -2], 4, (cx, cy, cz) =>
      cx === -1 && cy === -1 && cz === -1 ? { canonical } : null,
    );
    expect(sampleLoadedVoxelRegion(region, -1, -1, -1)).toBe(7);
    expect(sampleLoadedVoxelRegion(region, -2, -2, -2)).toBe(0);
    expect(sampleLoadedVoxelRegion(region, 0, -1, -1)).toBeUndefined();
    expect(sampleLoadedVoxelRegion(region, -3, -1, -1)).toBeUndefined();
    expect(sampleLoadedVoxelRegion(region, -1.5, -1, -1)).toBeUndefined();
    canonical[voxelIndex(31, 31, 31)] = 9;
    expect(sampleLoadedVoxelRegion(region, -1, -1, -1)).toBe(7);
    region.voxels.fill(11);
    expect(canonical[voxelIndex(31, 31, 31)]).toBe(9);
  });

  it('copies asymmetric canonical x/z/y rows into the light x/y/z layout', () => {
    const canonical = Uint16Array.from({ length: CHUNK_SIZE ** 3 }, (_, i) => i);
    const region = copyLoadedVoxelRegion([29, 30, 31], 4, (cx, cy, cz) =>
      cx === 0 && cy === 0 && cz === 0 ? { canonical } : null,
    );
    expect(sampleLoadedVoxelRegion(region, 30, 31, 31)).toBe(voxelIndex(30, 31, 31));
    expect(sampleLoadedVoxelRegion(region, 29, 30, 31)).toBe(voxelIndex(29, 30, 31));
    expect(sampleLoadedVoxelRegion(region, 30, 32, 31)).toBeUndefined();
  });

  it('enforces region bounds before reading or allocating', () => {
    const read = vi.fn(() => null);
    for (const size of [0, -1, 97, 1.5, NaN]) expect(() => copyLoadedVoxelRegion([0, 0, 0], size, read)).toThrow();
    expect(() => copyLoadedVoxelRegion([Number.MAX_SAFE_INTEGER, 0, 0], 2, read)).toThrow();
    expect(read).not.toHaveBeenCalled();
  });

  it('the actual collision owner rejects stale and released baselines, then reads a fresh replacement', () => {
    const canonical = new Uint16Array(CHUNK_SIZE ** 3);
    const chunks = new Map([['0,0,0', { canonical, fluid: new Uint8Array(CHUNK_SIZE ** 3), chunkRevision: 7 }]]);
    const guard = new AuthorityCollisionRevisionGuard();
    const baseline = new AuthorityCollisionBaselineClient(chunks, guard, async () => {
      throw new Error('No I/O');
    });
    const first = baseline.getLoadedVoxelRegion([0, 0, 0], 2);
    expect(first.loaded.every((v) => v === 1)).toBe(true);
    guard.require('0,0,0', 8);
    expect(baseline.getLoadedVoxelRegion([0, 0, 0], 2).loaded.every((v) => v === 0)).toBe(true);
    canonical.fill(3);
    chunks.set('0,0,0', { canonical, fluid: new Uint8Array(CHUNK_SIZE ** 3), chunkRevision: 8 });
    guard.satisfy('0,0,0', 8);
    expect(sampleLoadedVoxelRegion(baseline.getLoadedVoxelRegion([0, 0, 0], 2), 0, 0, 0)).toBe(3);
    expect(first.voxels.every((v) => v === 0)).toBe(true);
    const pending = guard.beginBaseline('0,0,0');
    guard.release('0,0,0');
    expect(baseline.getLoadedVoxelRegion([0, 0, 0], 2).loaded.every((v) => v === 0)).toBe(true);
    // The browser owner removes released cache entries before the last lease settles.
    chunks.delete('0,0,0');
    guard.finishBaseline(pending);
    expect(baseline.getLoadedVoxelRegion([0, 0, 0], 2).loaded.every((v) => v === 0)).toBe(true);
  });
});

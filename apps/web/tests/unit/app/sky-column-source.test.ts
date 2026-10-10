import { describe, expect, it, vi } from 'vitest';
import { Voxel } from '@seedlands/stdlib/world/voxel';
import { classicContent } from '../../fixtures/classic/content';
import {
  readSkyColumnProof,
  readSkyColumnProofByTask,
  type SkyColumnSource,
} from '../../../src/app/scene/sky-column-source';

const source = (): Extract<SkyColumnSource, { status: 'complete' }> => ({
  status: 'complete',
  cx: 0,
  cz: 0,
  epoch: 1,
  worldRevision: 0,
  directoryRevision: 0,
  generatedEmptyAboveY: 51,
  entries: [],
});
const reader = () => ({
  getChunkRevision: vi.fn((): number | null => 0),
  getVoxel: vi.fn((): number => Voxel.Air),
  voxelSemantics: classicContent.voxelSemantics,
});

describe('sky column proof uses authoritative source and current voxel revisions', () => {
  it('real task scheduling preserves full opaque, air and water samples', async () => {
    const voxels = {
      ...reader(),
      getVoxel: (_x: number, y: number) => (y === 40 ? Voxel.Stone : y === 39 ? Voxel.Water : Voxel.Air),
    };
    const proof = await readSkyColumnProofByTask(source(), [0, 0, 0], voxels, { isCurrent: () => true });
    expect(proof?.columns).toHaveLength(1024);
    expect(proof?.columns[1023]?.loaded).toEqual(new Uint8Array(52).fill(1));
    expect(proof?.columns[1023]?.obstruction[40]).toBe(255);
    expect(proof?.columns[1023]?.obstruction[0]).toBe(0);
    expect(proof?.columns[1023]?.obstruction[39]).toBeGreaterThan(0);
    expect(proof?.columns[1023]?.obstruction[39]).toBeLessThan(255);
  });
  it('an unknown voxel in a later task invalidates the whole proof', async () => {
    const voxels = { ...reader(), getVoxel: (x: number) => (x === 31 ? 65535 : Voxel.Air) };
    expect(await readSkyColumnProofByTask(source(), [0, 0, 0], voxels, { isCurrent: () => true })).toBeNull();
  });
  it('proven absent cells above the producer guarantee have a distinct marker without voxel reads', () => {
    const voxels = reader();
    const proof = readSkyColumnProof(source(), [0, 2, 0], voxels);
    expect(proof?.ceilingY).toBe(95);
    expect(proof?.columns[0]?.loaded).toEqual(new Uint8Array(32).fill(2));
    expect(voxels.getVoxel).not.toHaveBeenCalled();
  });
  it('dirty high chunks remain legal when the whole relevant column fits the budget', () => {
    const current = {
      ...source(),
      entries: [{ key: '0,10000,0', cx: 0, cy: 10000, cz: 0, revision: 3, resident: true, dirty: true }],
    };
    const voxels = reader();
    voxels.getChunkRevision.mockReturnValue(3);
    expect(readSkyColumnProof(current, [0, 10000, 0], voxels)?.ceilingY).toBe(320031);
  });
  it('negative producer guarantees and negative chunks remain legal', () => {
    expect(readSkyColumnProof({ ...source(), generatedEmptyAboveY: -33 }, [0, -2, 0], reader())?.ceilingY).toBe(-33);
  });
  it('512 samples are a work budget; 513 cannot be truncated into a proof', () => {
    const voxels = { ...reader(), getVoxel: () => Voxel.Air };
    expect(
      readSkyColumnProof({ ...source(), generatedEmptyAboveY: 511 }, [0, 0, 0], voxels)?.columns[0]?.loaded,
    ).toHaveLength(512);
    expect(readSkyColumnProof({ ...source(), generatedEmptyAboveY: 512 }, [0, 0, 0], voxels)).toBeNull();
  });

  it('uses generated guarantee only above its proven boundary and reads loaded cells below it', () => {
    const voxels = reader();
    const proof = readSkyColumnProof(source(), [0, 0, 0], voxels);
    expect(proof?.ceilingY).toBe(51);
    expect(proof?.columns).toHaveLength(1024);
    expect(proof?.columns[0]?.obstruction).toEqual(new Uint8Array(52));
    expect(voxels.getVoxel).toHaveBeenCalledTimes(52 * 1024);
  });
  it('unknown voxel semantics never publish a partial proof', () => {
    const voxels = reader();
    voxels.getVoxel.mockReturnValue(65535);
    expect(readSkyColumnProof(source(), [0, 0, 0], voxels)).toBeNull();
  });
  it('never promotes unloaded cells below the guarantee to air', () => {
    const voxels = reader();
    voxels.getChunkRevision.mockReturnValue(null);
    expect(readSkyColumnProof(source(), [0, 0, 0], voxels)).toBeNull();
    expect(voxels.getVoxel).not.toHaveBeenCalled();
  });
  it('persisted high obstructions over budget remain unknown rather than truncating the world', () => {
    const current = {
      ...source(),
      entries: [{ key: '0,10000,0', cx: 0, cy: 10000, cz: 0, revision: 1, resident: false, dirty: false }],
    };
    const voxels = reader();
    expect(readSkyColumnProof(current, [0, 0, 0], voxels)).toBeNull();
    expect(voxels.getVoxel).not.toHaveBeenCalled();
  });
  it('requires exact stored/current revisions before reading an obstruction', () => {
    const current = {
      ...source(),
      entries: [{ key: '0,1,0', cx: 0, cy: 1, cz: 0, revision: 3, resident: true, dirty: true }],
    };
    const voxels = reader();
    expect(readSkyColumnProof(current, [0, 0, 0], voxels)).toBeNull();
    expect(voxels.getVoxel).not.toHaveBeenCalled();
  });
  it('canonical light cost preserves opaque, transparent air and partial absorption', () => {
    const voxels = reader();
    voxels.getVoxel.mockImplementation((_x?: number, y?: number) =>
      y === 40 ? Voxel.Stone : y === 39 ? Voxel.Water : Voxel.Air,
    );
    const proof = readSkyColumnProof(source(), [0, 0, 0], voxels);
    expect(proof?.columns[0]?.obstruction[40]).toBe(255);
    expect(proof?.columns[0]?.obstruction[0]).toBe(0);
    expect(proof?.columns[0]?.obstruction[39]).toBeGreaterThan(0);
    expect(proof?.columns[0]?.obstruction[39]).toBeLessThan(255);
  });
});

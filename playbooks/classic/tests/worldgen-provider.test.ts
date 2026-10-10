import { describe, expect, it, vi } from 'vitest';
import { macroAt } from '@seedlands/stdlib/world/macro-world';
import { baseVoxel, CHUNK_SIZE, Voxel } from '@seedlands/stdlib/world/voxel';
import { createClassicWorldgenProvider } from '../src/worldgen';

describe('Classic worldgen provider column cache', () => {
  it('默认生成源明确提供空域保证而不是把世界高度截断', () => {
    const provider = createClassicWorldgenProvider();
    expect(provider.generatedEmptyAboveY?.({ seed: 1837, generatorVersion: 11, x: -33, z: 64 })).toBe(51);
    expect(provider.sampleVoxel({ seed: 1837, generatorVersion: 11, x: -33, y: 52, z: 64 })).toBe(0);
  });
  it('同identity的自定义生成器与宏观采样不获得默认保证，高层生成仍然合法', () => {
    const customGenerate = createClassicWorldgenProvider(() => new Uint16Array(CHUNK_SIZE ** 3).fill(Voxel.Stone));
    const customMacro = createClassicWorldgenProvider(undefined, (...args) => ({
      ...macroAt(...args),
      terrainHeight: 4096,
    }));
    const original = createClassicWorldgenProvider();
    for (const custom of [customGenerate, customMacro]) {
      expect(custom.identity).toEqual(original.identity);
      expect(custom.generatedEmptyAboveY).toBeUndefined();
    }
    expect(
      customGenerate.generate({
        seed: 1,
        generatorVersion: 11,
        coordinate: { x: 0, y: 128, z: 0 },
        epoch: 1,
        revision: 0,
      }).voxels[0],
    ).toBe(Voxel.Stone);
    expect(customMacro.sampleVoxel({ seed: 1, generatorVersion: 11, x: 0, y: 4096, z: 0 })).not.toBe(Voxel.Air);
  });
  it('支持版本的有限空域采样回归不冒充全球证明，未知版本或邻树整数边缘返回unknown', () => {
    const provider = createClassicWorldgenProvider();
    for (const generatorVersion of provider.identity.supportedGeneratorVersions) {
      const query = { seed: 1837, generatorVersion, x: -33, z: 64 };
      expect(provider.generatedEmptyAboveY?.(query)).toBe(51);
      for (const y of [52, 4097]) expect(provider.sampleVoxel({ ...query, y })).toBe(Voxel.Air);
    }
    const query = { seed: 1837, generatorVersion: 11, x: -33, z: 64 };
    expect(provider.generatedEmptyAboveY?.({ ...query, generatorVersion: 12 })).toBeNull();
    expect(provider.generatedEmptyAboveY?.({ ...query, x: Number.MAX_SAFE_INTEGER })).toBeNull();
    expect(provider.generatedEmptyAboveY?.({ ...query, z: Number.MIN_SAFE_INTEGER })).toBeNull();
  });
  it('声明当前 v11 与完整历史版本范围', () => {
    const provider = createClassicWorldgenProvider();
    expect(provider.identity).toMatchObject({
      implementationVersion: '11.0.0',
      configurationIdentity: 'seedlands:classic-terrain-g2-g11',
      supportedGeneratorVersions: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    });
    expect(provider.sampleVoxel({ seed: 2, generatorVersion: 11, x: 0, y: 64, z: 0 })).toBeTypeOf('number');
  });
  it('同一 seed/version/x/z 的连续体素采样复用宏观上下文且保持逐值等价', () => {
    const sampledMacro = vi.fn(macroAt);
    const provider = createClassicWorldgenProvider(undefined, sampledMacro);
    const input = { seed: 1837, generatorVersion: 10, x: 129, z: -65 } as const;

    const actual = [64, 65, 66].map((y) => provider.sampleVoxel({ ...input, y }));
    const expected = [64, 65, 66].map((y) => {
      const queryMacro = (x: number, z: number) => macroAt(input.seed, x, z, input.generatorVersion);
      return baseVoxel(
        input.seed,
        input.x,
        y,
        input.z,
        queryMacro(input.x, input.z),
        queryMacro,
        input.generatorVersion,
      );
    });

    expect(actual).toEqual(expected);
    expect(sampledMacro).toHaveBeenCalled();
    expect(sampledMacro.mock.calls.length).toBeLessThan(75);
  });

  it('seed、版本或列变化时不复用旧上下文', () => {
    const sampledMacro = vi.fn(macroAt);
    const provider = createClassicWorldgenProvider(undefined, sampledMacro);
    provider.sampleVoxel({ seed: 1, generatorVersion: 9, x: 0, y: 64, z: 0 });
    const afterFirst = sampledMacro.mock.calls.length;
    provider.sampleVoxel({ seed: 2, generatorVersion: 9, x: 0, y: 64, z: 0 });
    provider.sampleVoxel({ seed: 2, generatorVersion: 10, x: 0, y: 64, z: 0 });
    provider.sampleVoxel({ seed: 2, generatorVersion: 10, x: 1, y: 64, z: 0 });

    expect(sampledMacro.mock.calls.length).toBeGreaterThan(afterFirst);
  });
});

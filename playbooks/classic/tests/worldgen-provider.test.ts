import { describe, expect, it, vi } from 'vitest';
import { macroAt } from '@seedlands/stdlib/world/macro-world';
import { baseVoxel } from '@seedlands/stdlib/world/voxel';
import { createClassicWorldgenProvider } from '../src/worldgen';

describe('Classic worldgen provider column cache', () => {
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

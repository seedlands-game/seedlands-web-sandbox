import { describe, expect, it, vi } from 'vitest';
import { assembleWorldPacks, definePack } from '../../src/server/composition/assembly';
import {
  defineStandardWorldgenModule,
  worldgenProviderForComposition,
  type StandardWorldgenProvider,
} from '../../src/server/worldgen/standard-worldgen-module';
import { testWorldgenExecutableProvider } from '../support/worldgen';

const query = { seed: 1837, generatorVersion: 11, x: -33, z: 64 };

function registered(provider: StandardWorldgenProvider) {
  const pack = definePack({
    id: 'test:source-bound',
    kind: 'playbook',
    version: '1.0.0',
    modules: [defineStandardWorldgenModule({ moduleId: 'test:worldgen', provider })],
  });
  const composition = assembleWorldPacks(
    [
      {
        ...pack,
        integrity: { algorithm: 'sha256', manifestDigest: 'a'.repeat(64), entryDigest: 'b'.repeat(64), resources: [] },
      },
    ],
    { approvedPermissions: {} },
  );
  return { composition, provider: worldgenProviderForComposition(composition) };
}

describe('registered generated-source empty-space guarantee', () => {
  it('保留生产模块声明的只读保证及原生成采样函数', () => {
    const declared: StandardWorldgenProvider = { ...testWorldgenExecutableProvider, generatedEmptyAboveY: () => 51 };
    const { provider } = registered(declared);
    expect(provider.generatedEmptyAboveY?.(query)).toBe(51);
    expect(provider.generate).toBe(declared.generate);
    expect(provider.sampleVoxel).toBe(declared.sampleVoxel);
    expect(Object.isFrozen(provider)).toBe(true);
  });

  it('可选运行时保证不改存档的组成定义身份', () => {
    const before = registered(testWorldgenExecutableProvider);
    const after = registered({ ...testWorldgenExecutableProvider, generatedEmptyAboveY: () => 51 });
    expect(after.composition.definitionMap).toEqual(before.composition.definitionMap);
  });
  it('不从provider identity猜能力，不支持版本不调用保证源，允许全负高度生成源', () => {
    expect(registered(testWorldgenExecutableProvider).provider.generatedEmptyAboveY).toBeUndefined();
    const source = vi.fn(() => -5);
    const { provider } = registered({ ...testWorldgenExecutableProvider, generatedEmptyAboveY: source });
    expect(provider.generatedEmptyAboveY?.({ ...query, generatorVersion: 12 })).toBeNull();
    expect(source).not.toHaveBeenCalled();
    expect(provider.generatedEmptyAboveY?.(query)).toBe(-5);
  });
  it.each([NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1, undefined, '51'])(
    '已声明但不合法的source上界%j必须失败关闭',
    (result) => {
      const { provider } = registered({
        ...testWorldgenExecutableProvider,
        generatedEmptyAboveY: () => result as number,
      });
      expect(() => provider.generatedEmptyAboveY?.(query)).toThrow(/safe integer or null/);
    },
  );
  it.each(['seed', 'generatorVersion', 'x', 'z'] as const)('拒绝不安全的%s查询而不调用producer', (field) => {
    const source = vi.fn(() => 51);
    const { provider } = registered({ ...testWorldgenExecutableProvider, generatedEmptyAboveY: source });
    expect(() => provider.generatedEmptyAboveY?.({ ...query, [field]: NaN })).toThrow(/safe integers/);
    expect(source).not.toHaveBeenCalled();
  });
  it('拒绝坏的可执行source端口', () => {
    expect(() => registered({ ...testWorldgenExecutableProvider, generatedEmptyAboveY: 51 as never })).toThrow(
      /source port is invalid/,
    );
  });
});

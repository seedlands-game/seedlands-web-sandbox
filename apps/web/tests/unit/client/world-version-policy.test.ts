import { describe, expect, it } from 'vitest';
import {
  selectWorldGeneratorVersion,
  type WorldOpenMode,
} from '../../../../../packages/stdlib/src/runtime/world-version-policy';

describe('浏览器世界生成版本选择', () => {
  it('同 seed 有 v2 历史世界时继续 v2，没有历史时创建当前 v3', () => {
    const records = [
      { worldId: 'seedlands:g2:old-river', seedText: 'old-river', generatorVersion: 2, updatedAt: 10 },
      { worldId: 'seedlands:g3:other', seedText: 'other', generatorVersion: 3, updatedAt: 20 },
    ];
    expect(selectWorldGeneratorVersion(records, 'old-river', 3)).toBe(2);
    expect(selectWorldGeneratorVersion(records, 'new-river', 3)).toBe(3);
  });

  it('同 seed 已有当前版本时优先当前版本', () => {
    const records = [
      { worldId: 'seedlands:g2:same', seedText: 'same', generatorVersion: 2, updatedAt: 10 },
      { worldId: 'seedlands:g3:same', seedText: 'same', generatorVersion: 3, updatedAt: 20 },
    ];
    expect(selectWorldGeneratorVersion(records, 'same', 3)).toBe(3);
  });

  it('用户明确新建新版时保留 v2 并进入独立的 v3 world id', () => {
    const records = [{ worldId: 'seedlands:g2:old-river', seedText: 'old-river', generatorVersion: 2, updatedAt: 10 }];
    expect(selectWorldGeneratorVersion(records, 'old-river', 3, 'new-current')).toBe(3);
  });

  it('v2 与 v3 同时存在时仍能明确选择继续旧版', () => {
    const records = [
      { worldId: 'seedlands:g2:same', seedText: 'same', generatorVersion: 2, updatedAt: 10 },
      { worldId: 'seedlands:g3:same', seedText: 'same', generatorVersion: 3, updatedAt: 20 },
    ];
    expect(selectWorldGeneratorVersion(records, 'same', 3, 'continue-legacy')).toBe(2);
  });
});

const coexist = [2, 3, 4].map((generatorVersion) => ({
  worldId: `seedlands:g${generatorVersion}:same`,
  seedText: 'same',
  generatorVersion,
  updatedAt: generatorVersion,
}));
it.each([2, 3])('当前V4下显式选择V%i，不改选其他并存版本', (version) => {
  expect(selectWorldGeneratorVersion(coexist, 'same', 4, `continue-v${version}` as WorldOpenMode)).toBe(version);
});
it.each([2, 3])('指定V%i缺失时失败，不回退或新建当前世界', (version) => {
  expect(() =>
    selectWorldGeneratorVersion(
      coexist.filter((record) => record.generatorVersion !== version),
      'same',
      4,
      `continue-v${version}` as WorldOpenMode,
    ),
  ).toThrow(`v${version}`);
});
it('新版入口独立选择当前V4，默认继续仍优先当前版', () => {
  expect(selectWorldGeneratorVersion(coexist, 'same', 4, 'new-current')).toBe(4);
  expect(selectWorldGeneratorVersion(coexist, 'same', 4)).toBe(4);
});

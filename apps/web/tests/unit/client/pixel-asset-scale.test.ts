import { describe, expect, it } from 'vitest';
import { builtinAssets } from '../../../src/client/presentation/asset-catalog';
import {
  copyAssetBundle,
  resolvePixelModel,
  validateNativeAssets,
} from '../../../src/client/presentation/asset-package';
import { buildToolMesh } from '../../../src/client/presentation/voxel-tool-model';

const bounds = (positions: number[]) =>
  [0, 1, 2].map((axis) => {
    const values = positions.filter((_, index) => index % 3 === axis);
    return [Math.min(...values), Math.max(...values)];
  });

describe('细像素资产物理尺寸与副本兼容', () => {
  it('提高画布密度后尺寸不变，复制/导出再导入保留尺寸', () => {
    const model = builtinAssets.find((asset) => asset.id === 'builtin:model:wood-sword')!;
    const definition = resolvePixelModel(model, builtinAssets);
    expect(definition.pixels.length).toBe(32);
    const original = buildToolMesh(definition);
    expect(bounds(original.positions)[1][1] - bounds(original.positions)[1][0]).toBeLessThanOrEqual(1);
    let sequence = 0;
    const copied = validateNativeAssets(copyAssetBundle(model.id, builtinAssets, () => `copy:${sequence++}`));
    const copy = copied.find((asset) => asset.type === 'extruded-pixel-model')!;
    expect(buildToolMesh(resolvePixelModel(copy, copied)).positions).toEqual(original.positions);
  });

  it('旧模型省略密度时维持原 1/16 单位，不改变已有用户资产', () => {
    const data = buildToolMesh({ pixels: ['a'], palette: { a: [255, 255, 255] }, grip: [0, 0] });
    expect(bounds(data.positions)).toEqual([
      [0, 1 / 16],
      [-1 / 16, 0],
      [-1 / 16, 1 / 16],
    ]);
  });
});

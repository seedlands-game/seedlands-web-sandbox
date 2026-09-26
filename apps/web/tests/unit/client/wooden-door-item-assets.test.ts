import { describe, expect, it } from 'vitest';
import { acceptsPixelItem, assetDependencies } from '../../../src/client/presentation/asset-adapters';
import { builtinAssets, builtinBinding } from '../../../src/client/presentation/asset-catalog';
import { resolvePixelModel } from '../../../src/client/presentation/asset-package';
import { requireClassicItemDefinition } from '../../../src/client/presentation/classic-item-registry';
import { itemIconUrl } from '../../../src/app/gameplay/asset-image';
import { buildToolMesh } from '../../../src/client/presentation/voxel-tool-model';
import { utilitySprite } from '../../../src/client/presentation/utility-sprite';

describe('木门物品表现闭包', () => {
  it('完整目录直接加载 Structure 门的专用像素模型与图标，不恢复 placesVoxel', () => {
    const item = requireClassicItemDefinition('wooden-door');
    const binding = builtinBinding('wooden-door');
    expect(item).toMatchObject({ id: 'wooden-door', itemType: 'block' });
    expect(item.placesVoxel).toBeUndefined();
    expect(binding).toEqual({
      itemId: 'wooden-door',
      name: '木门',
      modelId: 'builtin:model:wooden-door',
      iconId: 'builtin:texture:wooden-door:detail',
    });

    const model = builtinAssets.find((asset) => asset.id === binding?.modelId);
    expect(model?.type).toBe('extruded-pixel-model');
    if (model?.type !== 'extruded-pixel-model') throw new Error('木门像素模型缺失');
    expect(assetDependencies(model)).toEqual([binding?.iconId]);
    const texture = builtinAssets.find((asset) => asset.id === model.payload.textureId);
    expect(texture?.type).toBe('pixel-texture');
    if (texture?.type !== 'pixel-texture') throw new Error('木门像素贴图缺失');
    expect(texture.payload.pixels).toEqual(utilitySprite('wooden-door'));
    expect(itemIconUrl('wooden-door', '/')).toMatch(/^data:image\/svg\+xml,/);
  });

  it('正式像素模型消费者生成非空门轮廓，并保持未知 Structure block 关闭', () => {
    const item = requireClassicItemDefinition('wooden-door');
    const model = builtinAssets.find((asset) => asset.id === 'builtin:model:wooden-door');
    if (model?.type !== 'extruded-pixel-model') throw new Error('木门像素模型缺失');
    const definition = resolvePixelModel(model, builtinAssets);
    const mesh = buildToolMesh(definition);

    expect(acceptsPixelItem(item)).toBe(true);
    expect(acceptsPixelItem({ id: 'unknown-structure', itemType: 'block' })).toBe(false);
    expect(definition.pixels).toHaveLength(32);
    expect(definition.pixels.every((row) => row.length === 32)).toBe(true);
    expect(definition.pixels.flatMap((row) => [...row]).filter((pixel) => pixel !== '.').length).toBeGreaterThan(300);
    expect(mesh.positions.length).toBeGreaterThan(0);
    expect(mesh.normals).toHaveLength(mesh.positions.length);
    expect(mesh.colors.length).toBe((mesh.positions.length / 3) * 4);
    expect(mesh.indices.length).toBeGreaterThan(36);
  });
});

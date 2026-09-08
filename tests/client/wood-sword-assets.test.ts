import { describe, expect, it } from 'vitest';
import { builtinAssets, builtinBinding } from '../../apps/web/src/client/presentation/asset-catalog';
import { acceptsPixelItem } from '../../apps/web/src/client/presentation/asset-adapters';
import { resolvePixelModel } from '../../apps/web/src/client/presentation/asset-package';
import { buildToolMesh, toolModelDefinition } from '../../apps/web/src/client/presentation/voxel-tool-model';

describe('木剑同源资产接入', () => {
  it('工坊、手持、掉落和图标绑定同一可编辑像素源', () => {
    const binding = builtinBinding('wood-sword');
    expect(binding).toBeDefined();
    const model = builtinAssets.find((asset) => asset.id === binding?.modelId);
    expect(model?.type).toBe('extruded-pixel-model');
    if (model?.type !== 'extruded-pixel-model') throw new Error('木剑模型缺失');
    expect(model.payload.textureId).toBe(binding?.iconId);
    const definition = resolvePixelModel(model, builtinAssets);
    expect(toolModelDefinition('wood-sword')).toEqual(definition);
    expect(buildToolMesh(definition).indices.length).toBeGreaterThan(36);
    expect(definition.pixels).toHaveLength(16);
    expect(definition.pixels.every((row) => row.length === 16)).toBe(true);
  });

  it('像素工具准入按物品类别而非两个旧物品名称', () => {
    expect(acceptsPixelItem({ id: 'wood-sword', itemType: 'tool' })).toBe(true);
    expect(acceptsPixelItem({ id: 'different-tool', itemType: 'tool' })).toBe(true);
    expect(acceptsPixelItem({ id: 'wood-axe', itemType: 'block', placesVoxel: 1 })).toBe(false);
    expect(acceptsPixelItem({ id: 'berry', itemType: 'food' })).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { parseAssetPackage, copyAssetBundle, resolvePixelModel } from '../../src/client/presentation/asset-package';
import { builtinAssets, builtinItemBindings } from '../../src/client/presentation/asset-catalog';
import { listItemDefinitions } from '../../src/server/gameplay/item-registry';
import { assetAdapter, acceptsPixelItem } from '../../src/client/presentation/asset-adapters';

describe('统一资产目录与有界适配', () => {
  it('完整覆盖真实物品，引用可解析，三类表现不混为一个编辑器', () => {
    expect(builtinItemBindings.map((b) => b.itemId).sort()).toEqual(
      listItemDefinitions()
        .map((i) => i.id)
        .sort(),
    );
    for (const binding of builtinItemBindings) {
      expect(binding.name).toBe(listItemDefinitions().find((item) => item.id === binding.itemId)?.name);
      expect(builtinAssets.some((a) => a.id === binding.iconId)).toBe(true);
      expect(builtinAssets.some((a) => a.id === binding.modelId)).toBe(true);
    }
    expect(assetAdapter('image-texture').editable).toBe(false);
    expect(assetAdapter('builtin-item-model').editable).toBe(false);
    expect(assetAdapter('extruded-pixel-model').editable).toBe(true);
    for (const item of listItemDefinitions()) {
      expect(acceptsPixelItem(item)).toBe(['wood-axe', 'stone-pickaxe'].includes(item.id));
    }
    expect(acceptsPixelItem({ id: 'wood-axe', itemType: 'tool', placesVoxel: 1 })).toBe(false);
    expect(acceptsPixelItem({ id: 'unknown', itemType: 'tool' })).toBe(false);
  });
  it('复制模型包含独立贴图，并在导出导入后可重建同一模型', () => {
    const binding = builtinItemBindings.find((b) => b.itemId === 'stone-pickaxe')!;
    let id = 0;
    const bundle = copyAssetBundle(binding.modelId, builtinAssets, () => `copy-${++id}`);
    expect(bundle).toHaveLength(2);
    const parsed = parseAssetPackage(JSON.stringify({ schemaVersion: 1, assets: bundle }));
    const model = parsed.find((a) => a.type === 'extruded-pixel-model')!;
    expect(resolvePixelModel(model, parsed)).toEqual(
      resolvePixelModel(
        builtinAssets.find((a) => a.id === binding.modelId)!,
        builtinAssets,
      ),
    );
    expect(bundle.every((a) => a.source === 'user')).toBe(true);
    expect(bundle.every((a) => !builtinAssets.some((b) => b.id === a.id))).toBe(true);
  });
  it('非法版本、未知类型、缺引用、非法像素、游戏绑定与超限包在写入前拒绝', () => {
    const binding = builtinItemBindings.find((b) => b.itemId === 'stone-pickaxe')!;
    let n = 0;
    const assets = copyAssetBundle(binding.modelId, builtinAssets, () => `local-${++n}`);
    for (const value of [
      { schemaVersion: 2, assets },
      { schemaVersion: 1, assets, bindings: [] },
      { schemaVersion: 1, assets: [...assets, assets[0]] },
      { schemaVersion: 1, assets: assets.filter((a) => a.type === 'extruded-pixel-model') },
      { schemaVersion: 1, assets: [{ ...assets[0], type: 'unknown' }] },
    ])
      expect(() => parseAssetPackage(JSON.stringify(value))).toThrow();
    const bad = structuredClone(assets);
    const texture = bad.find((a) => a.type === 'pixel-texture')!;
    texture.payload.pixels[0] = 999;
    expect(() => parseAssetPackage(JSON.stringify({ schemaVersion: 1, assets: bad }))).toThrow();
    expect(() => parseAssetPackage(' '.repeat(2 * 1024 * 1024 + 1))).toThrow();
  });
});

it('总厚度与共享原生源解释一致，编辑副本不会改变内置图标源', async () => {
  const { buildToolMesh } = await import('../../src/client/presentation/voxel-tool-model');
  const binding = builtinItemBindings.find((b) => b.itemId === 'stone-pickaxe')!;
  const model = builtinAssets.find((a) => a.id === binding.modelId)!;
  const definition = resolvePixelModel(model, builtinAssets);
  const mesh = buildToolMesh({ ...definition, thicknessPixels: 4 });
  const depth = mesh.positions.filter((_, i) => i % 3 === 2);
  expect(Math.max(...depth) - Math.min(...depth)).toBe(4 / 16);
  expect(binding.iconId).toBe(model.type === 'extruded-pixel-model' ? model.payload.textureId : '');
});

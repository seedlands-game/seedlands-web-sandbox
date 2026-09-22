import { expect, it } from 'vitest';
import { builtinAssets, builtinItemBindings } from '../../../src/client/presentation/asset-catalog';
import { assetDependencies } from '../../../src/client/presentation/asset-adapters';
import { Voxel, FaceMaterial } from '../../../../../packages/stdlib/src/world/voxel';
import { builtinTerrainTextures, terrainMaterials } from '../../../src/client/presentation/terrain-assets';
import { actorModelDefinitions } from '../../../src/client/presentation/actor-model-definitions';
import { listItemDefinitions } from '../../fixtures/classic/content';

it('当前视觉目录覆盖全部方块、面、物品、角色和手臂，引用能解析', () => {
  const ids = new Set(builtinAssets.map((a) => a.id));
  expect(ids.size).toBe(builtinAssets.length);
  expect(
    builtinAssets
      .filter((a) => a.type === 'builtin-voxel-model')
      .map((a) => a.payload.voxelId)
      .sort((a, b) => a - b),
  ).toEqual(Object.values(Voxel).filter((v) => v !== Voxel.Air));
  expect(terrainMaterials.map((m) => m.faceMaterial)).toEqual(Object.values(FaceMaterial));
  expect(builtinItemBindings.map((b) => b.itemId).sort()).toEqual(
    listItemDefinitions()
      .map((i) => i.id)
      .sort(),
  );
  expect(
    builtinAssets
      .filter((a) => a.type === 'builtin-actor-model')
      .map((a) => a.payload.kind)
      .sort(),
  ).toEqual(Object.keys(actorModelDefinitions).sort());
  expect(builtinAssets.some((a) => a.type === 'builtin-arm-model')).toBe(true);
  for (const asset of builtinAssets)
    for (const id of assetDependencies(asset)) expect(ids.has(id), `${asset.id} → ${id}`).toBe(true);
});

it('Classic 像素源保留植物轮廓、桶内容和十六色羊毛的独立视觉语义', () => {
  const texture = (id: string) => builtinAssets.find((asset) => asset.id === id);
  for (const face of [
    FaceMaterial.Sapling,
    FaceMaterial.TallGrass,
    FaceMaterial.Flower,
    FaceMaterial.Mushroom,
    FaceMaterial.SugarCane,
    FaceMaterial.DeadBush,
    FaceMaterial.RedFlower,
    FaceMaterial.RedMushroom,
  ]) {
    const terrain = builtinTerrainTextures.find(
      (candidate) => candidate.id === terrainMaterials.find((material) => material.faceMaterial === face)?.textureId,
    );
    expect(terrain, `missing terrain texture ${face}`).toBeDefined();
    expect(terrain!.payload.pixels).toContain(0);
    expect(terrain!.payload.pixels.filter((pixel) => pixel !== 0).length).toBeLessThan(180);
  }
  const bucketTextures = ['bucket', 'water-bucket', 'milk-bucket', 'lava-bucket'].map((id) =>
    texture(`builtin:texture:${id}:detail`)!,
  );
  expect(new Set(bucketTextures.map((asset) => JSON.stringify((asset as { payload: unknown }).payload))).size).toBe(4);
  const woolTextures = [
    'white',
    'orange',
    'magenta',
    'light-blue',
    'yellow',
    'lime',
    'pink',
    'gray',
    'light-gray',
    'cyan',
    'purple',
    'blue',
    'brown',
    'green',
    'red',
    'black',
  ].map((color) => texture(`builtin:texture:${color}-wool:detail`)!);
  expect(new Set(woolTextures.map((asset) => JSON.stringify((asset as { payload: unknown }).payload))).size).toBe(16);
  expect(texture('builtin:texture:leather:detail')).not.toEqual(texture('builtin:texture:raw-porkchop:detail'));
});

it('植物、食物与桶内容使用语义色板，工具仍保留原有材质色板', () => {
  const texture = (id: string) => builtinAssets.find((asset) => asset.id === `builtin:texture:${id}:detail`);
  const paletteOf = (id: string) => {
    const asset = texture(id);
    if (!asset || asset.type !== 'pixel-texture') throw new Error(`missing pixel source: ${id}`);
    return asset.payload.palette;
  };
  const flower = paletteOf('flower');
  expect(flower[16]).toEqual([190, 52, 48]);
  expect(flower[8]).toEqual([68, 124, 57]);
  expect(paletteOf('red-mushroom')[16]).toEqual([190, 52, 48]);
  expect(paletteOf('sugar-cane')[9]).toEqual([91, 154, 70]);
  expect(paletteOf('water-bucket')[18]).toEqual([42, 109, 145]);
  expect(paletteOf('lava-bucket')[16]).toEqual([190, 52, 48]);
  expect(paletteOf('golden-apple')[13]).toEqual([219, 171, 43]);
  expect(paletteOf('redstone-dust')[16]).toEqual([190, 52, 48]);
  expect(paletteOf('compass')[18]).toEqual([42, 109, 145]);
  expect(paletteOf('clock')[16]).toEqual([190, 52, 48]);
  expect(paletteOf('painting')[18]).toEqual([42, 109, 145]);
  expect(paletteOf('cocoa-beans')[2]).toEqual([103, 62, 37]);
  expect(paletteOf('wood-pickaxe')[8]).toEqual([97, 116, 119]);
});

it('红石、指南针、时钟、画作和可可豆保持各自的像素结构', () => {
  const pixelsOf = (id: string) => {
    const asset = builtinAssets.find((candidate) => candidate.id === `builtin:texture:${id}:detail`);
    if (!asset || asset.type !== 'pixel-texture') throw new Error(`missing pixel source: ${id}`);
    return asset.payload.pixels;
  };
  const compass = pixelsOf('compass');
  expect(compass[7 * 32 + 16]).toBe(16);
  expect(compass[22 * 32 + 12]).toBe(18);
  expect(pixelsOf('redstone-dust').filter((color) => color === 16).length).toBeGreaterThan(12);
  expect(pixelsOf('painting')).toContain(18);
  expect(pixelsOf('cocoa-beans').filter((color) => color === 2).length).toBeGreaterThan(10);
});

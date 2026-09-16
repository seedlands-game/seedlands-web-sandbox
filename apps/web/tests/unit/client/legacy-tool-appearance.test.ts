import { expect, it } from 'vitest';
import {
  createEmptyAppearanceProject,
  resolveAppearanceAssets,
} from '../../../src/client/presentation/appearance-project';
import { decodeState } from '../../../src/client/persistence/appearance-project-state';
import {
  resolvePixelModel,
  copyAssetBundle,
  validateNativeAssets,
} from '../../../src/client/presentation/asset-package';
import { builtinAssets, builtinBinding } from '../../../src/client/presentation/asset-catalog';

const items = [
  'wood-sword',
  'wood-axe',
  'stone-pickaxe',
  'wood-pickaxe',
  'iron-pickaxe',
  'coal',
  'raw-iron',
  'iron-ingot',
];
it.each(items)('旧 %s 仅纹理覆盖保持原16px模型并能解码所有项目槽', (id) => {
  const project = createEmptyAppearanceProject();
  project.assets.push({
    id: `builtin:texture:${id}`,
    name: '旧像素',
    source: 'user',
    revision: 2,
    type: 'pixel-texture',
    payload: {
      width: 16,
      height: 16,
      palette: [
        [0, 0, 0],
        [220, 120, 30],
      ],
      pixels: Array(256).fill(1),
    },
  });
  project.thumbnails[`builtin:model:${id}`] = 'data:image/png;base64,AAAA';
  const before = JSON.stringify(project);
  const state = decodeState({ revision: 1, draft: project, applied: project, previous: project });
  for (const entry of [state.draft, state.applied, state.previous!]) {
    expect(entry.thumbnails).toEqual(project.thumbnails);
    const resolved = resolveAppearanceAssets(entry);
    const model = resolved.find((asset) => asset.id === `builtin:model:${id}`)!;
    const definition = resolvePixelModel(model, resolved);
    expect(definition.pixels).toHaveLength(16);
    expect(definition.grip).toEqual([7.5, id === 'wood-sword' ? 12.5 : 11.5]);
    expect(definition.thicknessPixels).toBe(2);
    expect(definition.pixelsPerUnit).toBeUndefined();
    expect(definition.palette).toHaveProperty('a', [220, 120, 30]);
  }
  expect(JSON.stringify(project)).toBe(before);
});

it.each(items)('旧自定义模型可引用 %s 原始源，复制导出仍保持16px', (id) => {
  const project = createEmptyAppearanceProject();
  project.assets.push({
    id: 'user:model:old',
    name: '旧模型',
    source: 'user',
    revision: 1,
    type: 'extruded-pixel-model',
    payload: { textureId: `builtin:texture:${id}`, thicknessPixels: 3, grip: [8, 12], generatorVersion: 1 },
  });
  const resolved = resolveAppearanceAssets(project);
  let sequence = 0;
  const imported = validateNativeAssets(
    JSON.parse(JSON.stringify(copyAssetBundle('user:model:old', resolved, () => `user:copy:${sequence++}`))),
  );
  const model = imported.find((asset) => asset.type === 'extruded-pixel-model')!;
  expect(resolvePixelModel(model, imported).pixels).toHaveLength(16);
  const builtin = builtinAssets.find((asset) => asset.id === `builtin:model:${id}`)!;
  expect(resolvePixelModel(builtin, builtinAssets).pixels).toHaveLength(32);
  if (builtin.type !== 'extruded-pixel-model') throw new Error('Missing model');
  expect(builtin.payload.textureId).toBe(builtinBinding(id)?.iconId);
  expect(builtin.payload.textureId).not.toBe(`builtin:texture:${id}`);
});

it('原始内置16像素源保持冻结基线的完整payload', async () => {
  const { createHash } = await import('node:crypto');
  const { readFile } = await import('node:fs/promises');
  const fixture = JSON.parse(
    await readFile(new URL('./fixtures/legacy-item-texture-hashes.json', import.meta.url), 'utf8'),
  ) as { textures: Record<string, string> };
  for (const [id, hash] of Object.entries(fixture.textures)) {
    const asset = builtinAssets.find((asset) => asset.id === id)!;
    expect(createHash('sha256').update(JSON.stringify(asset.payload)).digest('hex'), id).toBe(hash);
  }
});

it('显式模型与新detail覆盖优先于旧纹理兼容几何', () => {
  const project = createEmptyAppearanceProject();
  const oldTexture = builtinAssets.find((asset) => asset.id === 'builtin:texture:wood-sword')!;
  project.assets.push({ ...structuredClone(oldTexture), source: 'user', revision: 2 });
  project.assets.push({
    id: 'builtin:model:wood-sword',
    name: '自定义模型',
    source: 'user',
    revision: 2,
    type: 'extruded-pixel-model',
    payload: { textureId: oldTexture.id, thicknessPixels: 6, grip: [1, 2], pixelsPerUnit: 16, generatorVersion: 1 },
  });
  let assets = resolveAppearanceAssets(project);
  let model = assets.find((asset) => asset.id === 'builtin:model:wood-sword')!;
  expect(resolvePixelModel(model, assets).grip).toEqual([1, 2]);
  expect(resolvePixelModel(model, assets).thicknessPixels).toBe(6);
  project.assets.pop();
  const newTexture = builtinAssets.find((asset) => asset.id === builtinBinding('wood-sword')!.iconId)!;
  project.assets.push({ ...structuredClone(newTexture), source: 'user', revision: 3 });
  assets = resolveAppearanceAssets(project);
  model = assets.find((asset) => asset.id === 'builtin:model:wood-sword')!;
  expect(resolvePixelModel(model, assets).pixelsPerUnit).toBe(32);
  expect(resolvePixelModel(model, assets).grip).toEqual([15.5, 25]);
});

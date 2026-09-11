import { expect, it } from 'vitest';
import { builtinAssets } from '../../../src/client/presentation/asset-catalog';
import {
  createEmptyAppearanceProject,
  validateAppearanceProject,
  resolveAppearanceAssets,
} from '../../../src/client/presentation/appearance-project';

it.each(['workbench', 'chest', 'furnace'])('旧项目可以仅引用 %s 的稳定内置像素源', (itemId) => {
  const textureId = `builtin:texture:${itemId}`;
  const project = createEmptyAppearanceProject();
  project.assets.push({
    id: 'user:model:legacy',
    name: '旧模型',
    source: 'user',
    revision: 1,
    type: 'extruded-pixel-model',
    payload: { textureId, thicknessPixels: 2, grip: [8, 13], generatorVersion: 1 },
  });
  const decoded = validateAppearanceProject(JSON.parse(JSON.stringify(project)));
  expect(resolveAppearanceAssets(decoded).find((asset) => asset.id === textureId)?.type).toBe('pixel-texture');
  const original = builtinAssets.find((asset) => asset.id === textureId)!;
  project.assets.push({ ...structuredClone(original), source: 'user', revision: 2 });
  expect(validateAppearanceProject(project).assets.find((asset) => asset.id === textureId)?.revision).toBe(2);
});

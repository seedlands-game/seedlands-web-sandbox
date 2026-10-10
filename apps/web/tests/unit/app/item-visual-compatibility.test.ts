import { afterEach, expect, it, vi } from 'vitest';
import * as pc from 'playcanvas';
import { PreviewScene } from '../../../src/app/asset-workbench/preview-scene';
import { setAppearanceImages, itemIconUrl } from '../../../src/app/gameplay/asset-image';
import { legacyStationIcons } from '../../../src/client/presentation/legacy-item-assets';
import { createEmptyAppearanceProject } from '../../../src/client/presentation/appearance-project';

const legacyPng = 'data:image/png;base64,bGVnYWN5';
afterEach(() => {
  setAppearanceImages(createEmptyAppearanceProject());
  vi.unstubAllGlobals();
});

it('旧工位像素覆盖继续显示；显式新图像覆盖优先', () => {
  vi.stubGlobal('document', {
    createElement: () => ({
      getContext: () => ({
        createImageData: (width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4) }),
        putImageData: vi.fn(),
      }),
      toDataURL: () => legacyPng,
    }),
  });
  const project = createEmptyAppearanceProject();
  project.assets = legacyStationIcons.map((asset) => ({ ...structuredClone(asset), source: 'user', revision: 2 }));
  setAppearanceImages(project);
  for (const item of ['workbench', 'chest', 'furnace']) expect(itemIconUrl(item, '/')).toBe(legacyPng);
  const replacement = 'data:image/png;base64,bmV3';
  project.assets.push({
    id: 'builtin:image:chest',
    type: 'image-texture',
    name: '箱子',
    revision: 2,
    source: 'user',
    payload: { path: replacement },
  });
  setAppearanceImages(project);
  expect(itemIconUrl('chest', '/')).toBe(replacement);
});

it('全透明模型明确拒绝取景，不能将 NaN 写入相机或场景', () => {
  const translate = vi.fn();
  const camera = new pc.Entity();
  const scene = Object.create(PreviewScene.prototype) as PreviewScene;
  Object.assign(scene, {
    camera,
    pivot: {
      findComponents: () => [
        { meshInstances: [{ aabb: new pc.BoundingBox(), node: new pc.Entity(), mesh: { getPositions: () => 0 } }] },
      ],
      setLocalPosition: vi.fn(),
      translate,
    },
  });
  expect(() => scene.frameThumbnail()).toThrow('没有可见像素或顶点');
  expect(translate).not.toHaveBeenCalled();
  expect([camera.getPosition().x, camera.getPosition().y, camera.getPosition().z].every(Number.isFinite)).toBe(true);
});

it('新增物品图标使用已注册像素或已派生的静态 PNG', () => {
  setAppearanceImages(createEmptyAppearanceProject());
  for (const id of [
    'stick',
    'charcoal',
    'cobblestone',
    'glass',
    'gold-ore',
    'diamond-ore',
    'iron-block',
    'gold-block',
    'diamond-block',
    'gold-ingot',
    'diamond',
    'gold-pickaxe',
    'diamond-pickaxe',
    'stone-axe',
    'iron-axe',
    'gold-axe',
    'diamond-axe',
    'stone-sword',
    'iron-sword',
    'gold-sword',
    'diamond-sword',
    'wood-shovel',
    'stone-shovel',
    'iron-shovel',
    'gold-shovel',
    'diamond-shovel',
    'wood-hoe',
    'stone-hoe',
    'iron-hoe',
    'gold-hoe',
    'diamond-hoe',
  ]) {
    expect(itemIconUrl(id, '/')).toMatch(/^(data:image\/svg\+xml,|\/assets\/item-thumbnails\/[^/]+\.png$)/);
  }
});

import { expect, it } from 'vitest';
import {
  createEmptyAppearanceProject,
  validateAppearanceProject,
} from '../../apps/web/src/client/presentation/appearance-project';
import { decodeState } from '../../apps/web/src/client/persistence/appearance-project-state';
import { validateNativeAssets } from '../../apps/web/src/client/presentation/asset-package';
import type { PixelTexture } from '../../apps/web/src/client/presentation/asset-types';

const texture = (index: number): PixelTexture => ({
  id: `user:legacy:${index}`,
  name: '原项目像素',
  source: 'user',
  revision: 1,
  type: 'pixel-texture',
  payload: {
    width: 16,
    height: 16,
    palette: [
      [0, 0, 0],
      [200, 100, 20],
    ],
    pixels: Array(256).fill(1),
  },
});
it.each([64, 71, 115, 128])('内置目录增长不挤占 %d 个用户资产的项目容量', (count) => {
  const project = createEmptyAppearanceProject();
  project.assets = Array.from({ length: count }, (_, index) => texture(index));
  const state = decodeState({ revision: 1, draft: project, applied: project, previous: project });
  expect(state.draft.assets).toHaveLength(count);
  expect(state.applied.assets).toHaveLength(count);
  expect(state.previous!.assets).toHaveLength(count);
});
it('项目与外部原生包仍拒绝第129个用户资产', () => {
  const project = createEmptyAppearanceProject();
  project.assets = Array.from({ length: 129 }, (_, index) => texture(index));
  expect(() => validateAppearanceProject(project)).toThrow();
  expect(() => validateNativeAssets(project.assets)).toThrow('资产数量超限');
});

it.each([105, 115])('旧项目的%d个非原生用户图像仍可加载', (count) => {
  const project = createEmptyAppearanceProject();
  project.assets = Array.from({ length: count }, (_, index) => ({
    id: `user:image:${index}`,
    name: '旧图像',
    source: 'user',
    revision: 1,
    type: 'image-texture',
    payload: { path: 'data:image/png;base64,AAAA' },
  }));
  expect(decodeState({ revision: 1, draft: project, applied: project, previous: project }).applied.assets).toHaveLength(
    count,
  );
});

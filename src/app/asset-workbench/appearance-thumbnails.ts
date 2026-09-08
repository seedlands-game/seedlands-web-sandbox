import type { Asset } from '../../client/presentation/asset-types';
import { builtinItemBindings } from '../../client/presentation/asset-catalog';
import { resolveAppearanceAssets, type AppearanceProject } from '../../client/presentation/appearance-project';
import { PreviewScene } from './preview-scene';

export async function renderAppearanceThumbnails(
  project: AppearanceProject,
  ids = builtinItemBindings.map((binding) => binding.modelId),
  additional: Asset[] = [],
): Promise<Record<string, string>> {
  const canvas = document.createElement('canvas');
  let scene: PreviewScene | undefined;
  try {
    scene = new PreviewScene(canvas, project, 512);
    const thumbnails: Record<string, string> = {};
    for (const id of ids) {
      const assets = [...resolveAppearanceAssets(project, id), ...additional];
      const asset = assets.find((candidate) => candidate.id === id);
      if (!asset) throw new Error(`无法生成缩略图：${id}`);
      await scene.show(asset, assets, 'model', 'nearest', 1);
      scene.reset();
      thumbnails[id] = await scene.capturePng();
    }
    return thumbnails;
  } finally {
    scene?.dispose();
    canvas.remove();
  }
}

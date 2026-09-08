import * as pc from 'playcanvas';
import { PreviewScene } from '../../../src/app/asset-workbench/preview-scene';
import {
  createEmptyAppearanceProject,
  resolveAppearanceAssets,
} from '../../../src/client/presentation/appearance-project';
import { renderAppearanceThumbnails } from '../../../src/app/asset-workbench/appearance-thumbnails';
import { loadAppearanceProject } from '../../../src/client/persistence/appearance-project-store';
export { loadAppearanceProject };

export async function snapshot() {
  const state = await loadAppearanceProject();
  return {
    ...state,
    thumbnailSizes: await Promise.all(
      Object.values(state.applied.thumbnails).map(async (source) => {
        const image = new Image();
        image.src = source;
        await image.decode();
        return [image.width, image.height];
      }),
    ),
  };
}

export function cameraPosition() {
  const camera = pc.Application.getApplication()?.root.findByName('Asset preview camera');
  return camera ? Array.from(camera.getPosition().toArray()) : null;
}

export function gameMaterials() {
  const app = pc.Application.getApplication()!;
  const materials = app.root
    .findComponents('render')
    .filter((component): component is pc.RenderComponent => component instanceof pc.RenderComponent)
    .flatMap((component) => component.meshInstances.map((instance) => instance.material));
  const world = materials.find((material) => material.name === 'voxel-opaque');
  const item = materials.find((material) => material.name === 'seedlands:material/terrain/lantern-frame');
  const arrayParameter = world?.getParameter('texture_voxelArray');
  const array: unknown = arrayParameter && 'data' in arrayParameter ? arrayParameter.data : null;
  const source: unknown = array instanceof pc.Texture ? array.getSource() : null;
  const frame: unknown = Array.isArray(source) ? source[11] : null;
  const surfaceParameter = world?.getParameter('uVoxelSurface[0]');
  const surface: unknown = surfaceParameter && 'data' in surfaceParameter ? surfaceParameter.data : null;
  return {
    framePixel:
      frame instanceof HTMLCanvasElement ? Array.from(frame.getContext('2d')!.getImageData(0, 0, 1, 1).data) : null,
    frameWidth: frame instanceof HTMLCanvasElement ? frame.width : null,
    worldGloss: surface instanceof Float32Array ? surface[22] : null,
    itemGloss: item instanceof pc.StandardMaterial ? item.gloss : null,
  };
}

export async function lanternFrames() {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:512px;height:512px';
  document.body.append(canvas);
  const scene = new PreviewScene(canvas, undefined, 512);
  const assets = resolveAppearanceAssets(createEmptyAppearanceProject());
  const item = assets.find((asset) => asset.id === 'builtin:model:lantern')!;
  const placed = assets.find((asset) => asset.type === 'builtin-voxel-model' && asset.name === '灯笼')!;
  const frames: Record<string, string> = {};
  try {
    for (const [name, model, mode] of [
      ['item', item, 'model'],
      ['placed', placed, 'model'],
      ['held', item, 'held'],
    ] as const) {
      await scene.show(model, assets, mode, 'nearest', 1);
      frames[name] = await scene.capturePng();
    }
    await scene.show(placed, assets, 'model', 'nearest', 1);
    scene.orbit(31, 12);
    const camera = scene.app.root.findByName('Asset preview camera')!;
    const before = Array.from(camera.getPosition().toArray());
    await scene.show(placed, assets, 'model', 'nearest', 1);
    return {
      frames,
      cameraPreserved: JSON.stringify(before) === JSON.stringify(Array.from(camera.getPosition().toArray())),
    };
  } finally {
    scene.dispose();
    canvas.remove();
  }
}

export async function builtinThumbnails() {
  return renderAppearanceThumbnails(createEmptyAppearanceProject());
}

export function currentScene() {
  const app = pc.Application.getApplication();
  if (!app) throw new Error('Missing application');
  const components = app.root
    .findComponents('render')
    .filter((component): component is pc.RenderComponent => component instanceof pc.RenderComponent);
  return {
    meshes: components.reduce((sum, component) => sum + component.meshInstances.length, 0),
    materials: components.flatMap((component) => component.meshInstances.map((instance) => instance.material.name)),
  };
}

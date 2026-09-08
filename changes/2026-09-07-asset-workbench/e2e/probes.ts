import * as pc from 'playcanvas';
import { loadAssetLibrary, saveAssetLibrary } from '../../../src/client/persistence/asset-workbench-store';
import { builtinAssets } from '../../../src/client/presentation/asset-catalog';
import { copyAssetBundle, resolvePixelModel } from '../../../src/client/presentation/asset-package';
import { buildToolMesh } from '../../../src/client/presentation/voxel-tool-model';

export async function storageCases() {
  const assets = copyAssetBundle('builtin:model:stone-pickaxe', builtinAssets, () => crypto.randomUUID());
  const writes = await Promise.allSettled([saveAssetLibrary(assets, 0), saveAssetLibrary(assets, 0)]);
  const before = await loadAssetLibrary();
  const put = IDBObjectStore.prototype.put;
  let failed = false;
  IDBObjectStore.prototype.put = () => {
    throw new DOMException('test quota', 'QuotaExceededError');
  };
  try {
    await saveAssetLibrary(assets, before.revision);
  } catch {
    failed = true;
  } finally {
    IDBObjectStore.prototype.put = put;
  }
  const after = await loadAssetLibrary();
  return {
    fulfilled: writes.filter((w) => w.status === 'fulfilled').length,
    rejected: writes.filter((w) => w.status === 'rejected').length,
    failed,
    unchanged: JSON.stringify(before) === JSON.stringify(after),
    revision: after.revision,
  };
}

export function resourceProbe() {
  const updated = new Set<pc.Mesh>(),
    destroyed = new Set<pc.Mesh>();
  const textures = new Set<pc.Texture>();
  const update = pc.Mesh.prototype.update,
    destroy = pc.Mesh.prototype.destroy;
  const textureDestroy = pc.Texture.prototype.destroy;
  let repeated = 0;
  pc.Mesh.prototype.update = function (...args: Parameters<typeof update>) {
    updated.add(this);
    return update.apply(this, args);
  };
  pc.Mesh.prototype.destroy = function () {
    if (destroyed.has(this)) repeated++;
    destroyed.add(this);
    return destroy.call(this);
  };
  pc.Texture.prototype.destroy = function () {
    textures.add(this);
    return textureDestroy.call(this);
  };
  return () => {
    const result = {
      generated: updated.size,
      destroyed: destroyed.size,
      live: [...updated].filter((m) => !destroyed.has(m)).length,
      repeated,
      texturesDestroyed: textures.size,
    };
    pc.Mesh.prototype.update = update;
    pc.Mesh.prototype.destroy = destroy;
    pc.Texture.prototype.destroy = textureDestroy;
    return result;
  };
}

export function heldMatchesSource(itemId: string) {
  const node = pc.Application.getApplication()!.root.findByName(`pixel-tool:${itemId}`) as pc.Entity | null;
  if (!node?.render) return false;
  const actual: number[] = [];
  node.render.meshInstances[0].mesh.getPositions(actual);
  const asset = builtinAssets.find((a) => a.id === `builtin:model:${itemId}`)!;
  const expected = buildToolMesh(resolvePixelModel(asset, builtinAssets)).positions;
  return actual.length === expected.length && actual.every((v, i) => Math.abs(v - expected[i]) < 1e-6);
}
export function heldPose() {
  return (
    pc.Application.getApplication()!.root.findByName('viewmodel hand pivot')?.getLocalEulerAngles().toArray() ?? []
  );
}

let releaseImage: (() => Promise<void>) | null = null;
export function delayImageDecode() {
  const original = HTMLImageElement.prototype.decode;
  HTMLImageElement.prototype.decode = function () {
    HTMLImageElement.prototype.decode = original;
    return new Promise<void>((resolve, reject) => {
      releaseImage = async () => {
        try {
          await original.call(this);
          resolve();
        } catch (error) {
          reject(error);
        }
      };
    });
  };
}
export async function resumeImageDecode() {
  await releaseImage?.();
  releaseImage = null;
}
export function currentPreviewNodes() {
  const root = pc.Application.getApplication()!.root;
  return { pixel: !!root.findByName('draft-pixel-model'), plane: !!root.findByName('Asset texture plane') };
}

import * as pc from 'playcanvas';
import { loadTerrainPack, saveTerrainPack } from '../../../src/client/persistence/terrain-pack-store';
import { builtinTerrainTextures } from '../../../src/client/presentation/terrain-assets';
export function sceneState() {
  const app = pc.Application.getApplication()!;
  return {
    renderCount: app.root.findComponents('render').length,
    arm: !!app.root.findByName('hand'),
    cuff: !!app.root.findByName('sleeve-cuff'),
  };
}
export function gameDirtPixels() {
  const app = pc.Application.getApplication()!;
  for (const component of app.root.findComponents('render')) {
    if (!(component instanceof pc.RenderComponent)) continue;
    for (const instance of component.meshInstances) {
      const material = instance.material;
      if (material.name !== 'voxel-opaque') continue;
      const parameter = material.getParameter('texture_voxelArray');
      if (!parameter || !('data' in parameter) || !(parameter.data instanceof pc.Texture)) continue;
      const texture = parameter.data;
      const source: unknown = texture.getSource();
      if (!Array.isArray(source)) continue;
      const layer: unknown = source[2];
      if (layer instanceof HTMLCanvasElement)
        return { width: layer.width, pixels: Array.from(layer.getContext('2d')!.getImageData(0, 0, 16, 16).data) };
    }
  }
  return null;
}
export async function packStorageCases() {
  const before = await loadTerrainPack();
  const source = structuredClone(builtinTerrainTextures[2]);
  const writes = await Promise.allSettled([
    saveTerrainPack([{ faceMaterial: 3, texture: source }], before.contentRevision),
    saveTerrainPack([], before.contentRevision),
  ]);
  const saved = await loadTerrainPack();
  const original = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = () => {
    throw new DOMException('injected quota', 'QuotaExceededError');
  };
  let rejected = false;
  try {
    await saveTerrainPack([], saved.contentRevision);
  } catch {
    rejected = true;
  } finally {
    IDBObjectStore.prototype.put = original;
  }
  return {
    success: writes.filter((w) => w.status === 'fulfilled').length,
    rejected,
    unchanged: JSON.stringify(saved) === JSON.stringify(await loadTerrainPack()),
  };
}
let stop: (() => { live: number; repeated: number }) | undefined;
export function startResources() {
  const updated = new Set<pc.Mesh>(),
    destroyed = new Set<pc.Mesh>();
  const update = pc.Mesh.prototype.update,
    destroy = pc.Mesh.prototype.destroy;
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
  stop = () => {
    pc.Mesh.prototype.update = update;
    pc.Mesh.prototype.destroy = destroy;
    return { live: [...updated].filter((mesh) => !destroyed.has(mesh)).length, repeated };
  };
}
export function stopResources() {
  return stop?.();
}

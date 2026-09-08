import * as pc from 'playcanvas';
import { loadGlbBlob } from '../../client/persistence/glb-model-store';

function releaseContainer(app: pc.Application, asset: pc.Asset): void {
  app.assets.remove(asset);
  asset.unload();
}

export function normalizeGlbBounds(
  min: readonly [number, number, number],
  max: readonly [number, number, number],
): Readonly<{ position: readonly [number, number, number]; scale: number }> {
  const maxEdge = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  if (!Number.isFinite(maxEdge) || maxEdge <= 0) return { position: [0, 0, 0], scale: 1 };
  const scale = 1.5 / maxEdge;
  return {
    position: [-((min[0] + max[0]) / 2) * scale, -((min[1] + max[1]) / 2) * scale, -((min[2] + max[2]) / 2) * scale],
    scale,
  };
}

function centerAndNormalize(wrapper: pc.Entity, source: pc.Entity): void {
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity,
    maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (const component of source.findComponents('render')) {
    if (!(component instanceof pc.RenderComponent)) continue;
    component.isStatic = true;
    component.castShadows = false;
    for (const instance of component.meshInstances) {
      const { center, halfExtents } = instance.aabb;
      minX = Math.min(minX, center.x - halfExtents.x);
      minY = Math.min(minY, center.y - halfExtents.y);
      minZ = Math.min(minZ, center.z - halfExtents.z);
      maxX = Math.max(maxX, center.x + halfExtents.x);
      maxY = Math.max(maxY, center.y + halfExtents.y);
      maxZ = Math.max(maxZ, center.z + halfExtents.z);
    }
  }
  if (!Number.isFinite(minX)) return;
  const transform = normalizeGlbBounds([minX, minY, minZ], [maxX, maxY, maxZ]);
  wrapper.setLocalPosition(...transform.position);
  wrapper.setLocalScale(transform.scale, transform.scale, transform.scale);
}

const abortError = () => new Error('GLB 模型加载已取消');

async function loadContainer(app: pc.Application, url: string, id: string, signal?: AbortSignal): Promise<pc.Asset> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const discard = (asset: pc.Asset | undefined) => {
      if (!asset) return;
      releaseContainer(app, asset);
    };
    const complete = () => signal?.removeEventListener('abort', abort);
    const abort = () => {
      discard(app.assets.getByUrl(url));
      if (settled) return;
      settled = true;
      complete();
      reject(abortError());
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener('abort', abort, { once: true });
    app.assets.loadFromUrlAndFilename(url, `${id}.glb`, 'container', (error, asset) => {
      if (settled) {
        discard(asset);
        return;
      }
      if (error || !asset) {
        discard(asset);
        settled = true;
        complete();
        reject(new Error(`GLB 模型加载失败：${error ?? '未返回容器资源'}`));
        return;
      }
      settled = true;
      complete();
      resolve(asset);
    });
  });
}

/** Loads one persisted static GLB into the existing PlayCanvas application. The returned lease owns all GPU assets. */
export async function addGlbModel(
  app: pc.Application,
  parent: pc.Entity,
  id: string,
  signal?: AbortSignal,
): Promise<{ release: () => void }> {
  const blob = await loadGlbBlob(id);
  if (signal?.aborted) throw abortError();
  const url = URL.createObjectURL(blob);
  let asset: pc.Asset | null = null;
  let wrapper: pc.Entity | null = null;
  let source: pc.Entity | null = null;
  try {
    asset = await loadContainer(app, url, id, signal);
    if (signal?.aborted) throw abortError();
    const resource = asset.resource as pc.ContainerResource | null;
    if (!resource) throw new Error('GLB 容器资源不可用');
    source = resource.instantiateRenderEntity({ castShadows: false });
    wrapper = new pc.Entity(`glb-model:${id}`, app);
    wrapper.addChild(source);
    centerAndNormalize(wrapper, source);
    if (signal?.aborted) throw abortError();
    parent.addChild(wrapper);
  } catch (error) {
    wrapper?.destroy();
    source?.destroy();
    if (asset) releaseContainer(app, asset);
    URL.revokeObjectURL(url);
    throw error;
  }
  let released = false;
  return {
    release: () => {
      if (released) return;
      released = true;
      wrapper?.destroy();
      releaseContainer(app, asset!);
      URL.revokeObjectURL(url);
    },
  };
}

import type * as pc from 'playcanvas';
import { classicCreatureDefinition } from '../../client/presentation/classic-creature-definitions';
import { validateStaticGlb } from '../../client/presentation/glb-model';
import { publicAssetUrl } from '../../client/presentation/public-asset-url';

// One bounded (12-species) CPU resource cache per Application. GPU containers remain lease-owned.
const caches = new WeakMap<pc.Application, Map<string, Promise<Blob>>>();
export function loadClassicCreatureBlob(app: pc.Application, modelId: string): Promise<Blob> | undefined {
  const definition = classicCreatureDefinition(modelId);
  if (!definition || definition.modelId !== modelId) return undefined;
  let cache = caches.get(app);
  if (!cache) {
    cache = new Map();
    caches.set(app, cache);
    const owned = cache;
    app.once('destroy', () => {
      owned.clear();
      caches.delete(app);
    });
  }
  const ownedCache = cache;
  const existing = ownedCache.get(modelId);
  if (existing) return existing;
  const abort = new AbortController();
  app.once('destroy', abort.abort, abort);
  const loading = fetch(publicAssetUrl(import.meta.env.BASE_URL, definition.path), { signal: abort.signal })
    .then(async (response) => {
      if (!response.ok) throw new Error(`${definition.name}模型请求失败：HTTP ${response.status}`);
      const bytes = await response.arrayBuffer();
      const stats = validateStaticGlb(bytes);
      const names = new Set(stats.animationClips.map((clip) => clip.name));
      if (!Object.values(definition.clips).every((clip) => names.has(clip)))
        throw new Error(`${definition.name}模型缺少必需动作`);
      return new Blob([bytes], { type: 'model/gltf-binary' });
    })
    .catch((error: unknown) => {
      ownedCache.delete(modelId);
      throw error;
    })
    .finally(() => app.off('destroy', abort.abort, abort));
  ownedCache.set(modelId, loading);
  return loading;
}

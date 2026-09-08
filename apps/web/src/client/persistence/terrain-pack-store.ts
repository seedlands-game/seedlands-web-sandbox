import type { PixelTexture } from '../presentation/asset-types';
import { validateTerrainTexture } from '../presentation/texture-pack';
import { builtinTerrainTextures, terrainMaterial } from '../presentation/terrain-assets';

export type TerrainOverride = { faceMaterial: number; texture: PixelTexture };
export type TerrainPack = { schemaVersion: 1; contentRevision: number; style: 'pixel16'; overrides: TerrainOverride[] };
const empty = (): TerrainPack => ({ schemaVersion: 1, contentRevision: 0, style: 'pixel16', overrides: [] });
function decode(value: unknown): TerrainPack {
  if (value === undefined) return empty();
  if (typeof value !== 'object' || !value) throw new Error('地形资源包损坏');
  const pack = value as Partial<TerrainPack>;
  if (
    pack.schemaVersion !== 1 ||
    pack.style !== 'pixel16' ||
    !Number.isSafeInteger(pack.contentRevision) ||
    (pack.contentRevision ?? -1) < 0 ||
    !Array.isArray(pack.overrides) ||
    pack.overrides.length > 13
  )
    throw new Error('地形资源包格式不受支持');
  const ids = new Set<number>();
  const overrides = pack.overrides.map((entry) => {
    if (!entry || typeof entry !== 'object' || ids.has(entry.faceMaterial)) throw new Error('材质覆盖冲突');
    ids.add(entry.faceMaterial);
    return { faceMaterial: entry.faceMaterial, texture: validateTerrainTexture(entry.texture, entry.faceMaterial) };
  });
  return { schemaVersion: 1, contentRevision: pack.contentRevision!, style: 'pixel16', overrides };
}
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('seedlands-terrain-pack', 1);
    let expired = false;
    const timer = setTimeout(() => {
      expired = true;
      reject(new Error('资源包库打开超时'));
    }, 5000);
    request.onupgradeneeded = () => request.result.createObjectStore('pack');
    request.onerror = () => {
      clearTimeout(timer);
      reject(request.error);
    };
    request.onsuccess = () => {
      clearTimeout(timer);
      if (expired) {
        request.result.close();
        return;
      }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}
export async function loadTerrainPack(): Promise<TerrainPack> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('pack', 'readonly');
      const request = tx.objectStore('pack').get('active');
      let result: TerrainPack;
      request.onsuccess = () => {
        try {
          result = decode(request.result);
        } catch (error) {
          reject(error);
        }
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('资源包读取失败'));
    });
  } finally {
    db.close();
  }
}
export async function saveTerrainPack(overrides: TerrainOverride[], expectedRevision: number): Promise<TerrainPack> {
  const snapshot = decode({ ...empty(), contentRevision: expectedRevision + 1, overrides });
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('pack', 'readwrite');
      const store = tx.objectStore('pack');
      const request = store.get('active');
      let problem: unknown;
      request.onsuccess = () => {
        try {
          if (decode(request.result).contentRevision !== expectedRevision)
            throw new Error('另一页面已更新资源包，请重新加载后应用');
          store.put(snapshot, 'active');
        } catch (error) {
          problem = error;
          tx.abort();
        }
      };
      tx.oncomplete = () => resolve(snapshot);
      tx.onabort = tx.onerror = () => reject(problem ?? tx.error ?? new Error('资源包保存失败'));
    });
  } finally {
    db.close();
  }
}
export function resolveTerrainTextures(pack: TerrainPack): PixelTexture[] {
  const checked = decode(pack);
  return builtinTerrainTextures.map((texture) => {
    const override = checked.overrides.find((entry) => terrainMaterial(entry.faceMaterial)?.textureId === texture.id);
    return override ? { ...override.texture, id: texture.id } : texture;
  });
}

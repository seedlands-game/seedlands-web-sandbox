import type { NativeAsset } from '../presentation/asset-types';
import { validateNativeAssets } from '../presentation/asset-package';

export type AssetLibrary = { schemaVersion: 1; revision: number; assets: NativeAsset[] };
const empty = (): AssetLibrary => ({ schemaVersion: 1, revision: 0, assets: [] });
function decode(value: unknown): AssetLibrary {
  if (value === undefined) return empty();
  if (typeof value !== 'object' || value === null) throw new Error('本地资产库损坏');
  const library = value as Partial<AssetLibrary>;
  if (library.schemaVersion !== 1 || !Number.isSafeInteger(library.revision) || (library.revision ?? -1) < 0)
    throw new Error('本地资产库版本不受支持，请保留已有数据');
  return { schemaVersion: 1, revision: library.revision!, assets: validateNativeAssets(library.assets) };
}
async function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('seedlands-asset-workbench', 1);
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      reject(new Error('资产库打开超时，请关闭其他旧版本页面后重试'));
    }, 5000);
    request.onupgradeneeded = () => request.result.createObjectStore('library');
    request.onsuccess = () => {
      clearTimeout(timer);
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => {
      clearTimeout(timer);
      settled = true;
      reject(request.error);
    };
  });
}
export async function loadAssetLibrary(): Promise<AssetLibrary> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('library', 'readonly');
      const request = transaction.objectStore('library').get('current');
      let result = empty();
      request.onsuccess = () => {
        try {
          result = decode(request.result);
        } catch (error) {
          reject(error);
        }
      };
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new Error('资产库读取中断'));
    });
  } finally {
    db.close();
  }
}
export async function saveAssetLibrary(assets: NativeAsset[], expectedRevision: number): Promise<AssetLibrary> {
  const validated = validateNativeAssets(assets);
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('library', 'readwrite');
      const store = transaction.objectStore('library');
      const request = store.get('current');
      let result: AssetLibrary;
      let problem: unknown;
      request.onsuccess = () => {
        try {
          const current = decode(request.result);
          if (current.revision !== expectedRevision)
            throw new Error('另一个页面已保存新版本。草稿已保留，请导出备份后重新加载，或另存为副本。');
          result = { schemaVersion: 1, revision: current.revision + 1, assets: validated };
          store.put(result, 'current');
        } catch (error) {
          problem = error;
          transaction.abort();
        }
      };
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(problem ?? transaction.error);
      transaction.onabort = () => reject(problem ?? transaction.error ?? new Error('保存被中断，草稿仍保留'));
    });
  } finally {
    db.close();
  }
}

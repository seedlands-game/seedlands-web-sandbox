import {
  inspectGlbFile,
  MAX_GLB_LIBRARY_BYTES,
  MAX_GLB_MODELS,
  MAX_GLB_NODES,
  MAX_GLB_TRIANGLES,
  type StoredGlb,
} from '../presentation/glb-model';

type StoredRecord = StoredGlb & { blob: Blob };

const databaseName = 'seedlands-glb-assets';
const storeName = 'models';

const writeError = (error: unknown) =>
  new Error(`保存 GLB 失败，原库未改变：${error instanceof Error ? error.message : String(error)}`);

function metadata(record: StoredRecord): StoredGlb {
  return {
    id: record.id,
    name: record.name,
    revision: 1,
    byteLength: record.byteLength,
    nodeCount: record.nodeCount,
    triangleCount: record.triangleCount,
  };
}

function decodeRecord(value: unknown): StoredRecord {
  if (typeof value !== 'object' || value === null) throw new Error('GLB 模型库记录损坏，请保留已有数据');
  const record = value as Partial<StoredRecord>;
  const byteLength = record.byteLength;
  const nodeCount = record.nodeCount;
  const triangleCount = record.triangleCount;
  if (
    typeof record.id !== 'string' ||
    !record.id ||
    typeof record.name !== 'string' ||
    !record.name ||
    record.revision !== 1 ||
    !Number.isSafeInteger(byteLength) ||
    (byteLength ?? 0) <= 0 ||
    !Number.isSafeInteger(nodeCount) ||
    (nodeCount ?? -1) < 0 ||
    (nodeCount ?? Infinity) > MAX_GLB_NODES ||
    !Number.isSafeInteger(triangleCount) ||
    (triangleCount ?? -1) < 0 ||
    (triangleCount ?? Infinity) > MAX_GLB_TRIANGLES ||
    !(record.blob instanceof Blob) ||
    record.blob.size !== byteLength
  )
    throw new Error('GLB 模型库记录损坏，请保留已有数据');
  return record as StoredRecord;
}

async function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      reject(new Error('GLB 模型库打开超时，请关闭其他旧版本页面后重试'));
    }, 5000);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName))
        request.result.createObjectStore(storeName, { keyPath: 'id' });
    };
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
      reject(request.error ?? new Error('GLB 模型库无法打开'));
    };
  });
}

export async function listGlbModels(): Promise<StoredGlb[]> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readonly');
      const request = transaction.objectStore(storeName).getAll();
      let records: StoredGlb[] = [];
      request.onsuccess = () => {
        try {
          records = request.result
            .map(decodeRecord)
            .map(metadata)
            .sort((a, b) => a.name.localeCompare(b.name));
        } catch (error) {
          reject(error);
        }
      };
      transaction.oncomplete = () => resolve(records);
      transaction.onabort = () => reject(transaction.error ?? new Error('读取 GLB 模型库被中断'));
      transaction.onerror = () => reject(transaction.error ?? new Error('读取 GLB 模型库失败'));
    });
  } finally {
    database.close();
  }
}

const makeId = () =>
  typeof crypto.randomUUID === 'function'
    ? `glb:${crypto.randomUUID()}`
    : `glb:${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export async function importGlbModel(file: File): Promise<StoredGlb> {
  const stats = await inspectGlbFile(file);
  const next: StoredRecord = {
    id: makeId(),
    name: file.name,
    revision: 1,
    byteLength: file.size,
    nodeCount: stats.nodeCount,
    triangleCount: stats.triangleCount,
    blob: file.slice(0, file.size, 'model/gltf-binary'),
  };
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.getAll();
      let problem: unknown;
      request.onsuccess = () => {
        try {
          const current = request.result.map(decodeRecord);
          const byteLength = current.reduce((total, record) => total + record.byteLength, 0);
          if (current.length >= MAX_GLB_MODELS) throw new Error(`GLB 模型库最多保存 ${MAX_GLB_MODELS} 个模型`);
          if (byteLength + next.byteLength > MAX_GLB_LIBRARY_BYTES)
            throw new Error(`GLB 模型库最多保存 ${MAX_GLB_LIBRARY_BYTES / 1024 / 1024} MiB`);
          store.add(next);
        } catch (error) {
          problem = error;
          transaction.abort();
        }
      };
      transaction.oncomplete = () => resolve(metadata(next));
      transaction.onerror = () => reject(problem instanceof Error ? problem : writeError(transaction.error));
      transaction.onabort = () => reject(problem instanceof Error ? problem : writeError(transaction.error));
    });
  } finally {
    database.close();
  }
}

export async function loadGlbBlob(id: string): Promise<Blob> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readonly');
      const request = transaction.objectStore(storeName).get(id);
      let blob: Blob | null = null;
      request.onsuccess = () => {
        try {
          if (request.result === undefined) throw new Error('GLB 模型不存在，可能已被删除');
          blob = decodeRecord(request.result).blob;
        } catch (error) {
          reject(error);
        }
      };
      transaction.oncomplete = () => (blob ? resolve(blob) : reject(new Error('GLB 模型读取失败')));
      transaction.onabort = () => reject(transaction.error ?? new Error('GLB 模型读取被中断'));
      transaction.onerror = () => reject(transaction.error ?? new Error('GLB 模型读取失败'));
    });
  } finally {
    database.close();
  }
}

export async function deleteGlbModel(id: string): Promise<void> {
  if (!id) throw new Error('GLB 模型标识不能为空');
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readwrite');
      transaction.objectStore(storeName).delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(writeError(transaction.error));
      transaction.onerror = () => reject(writeError(transaction.error));
    });
  } finally {
    database.close();
  }
}

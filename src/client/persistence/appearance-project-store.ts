import { validateStaticGlb, MAX_GLB_MODELS, type StoredGlb } from '../presentation/glb-model';
import {
  createEmptyAppearanceProject,
  validateAppearanceProject,
  type AppearanceProject,
} from '../presentation/appearance-project';
import { loadTerrainPack, resolveTerrainTextures } from './terrain-pack-store';

export const MAX_APPEARANCE_PACKAGE_BYTES = 96 * 1024 * 1024;

export type AppearanceProjectState = Readonly<{
  revision: number;
  draft: AppearanceProject;
  applied: AppearanceProject;
  previous: AppearanceProject | null;
}>;
export type AppearanceModelBlob = StoredGlb & Readonly<{ blob: Blob }>;
export type AppearanceModelInput = Readonly<{ id: string; name: string; revision: number; blob: Blob }>;

const databaseName = 'seedlands-appearance-project';
const projectStoreName = 'project';
const modelsStoreName = 'models';
const empty = (): AppearanceProjectState => ({
  revision: 0,
  draft: createEmptyAppearanceProject(),
  applied: createEmptyAppearanceProject(),
  previous: null,
});
const fail = (message: string): never => {
  throw new Error(message);
};
const object = (value: unknown, label: string): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : fail(`${label}格式无效`);
const id = (value: unknown, label: string): string =>
  typeof value === 'string' && value.trim() && value.length <= 120 ? value : fail(`${label}无效`);
const revision = (value: unknown, label: string): number =>
  Number.isSafeInteger(value) && (value as number) >= 1 ? (value as number) : fail(`${label}无效`);

function decodeState(value: unknown): AppearanceProjectState {
  if (value === undefined) return empty();
  const record = object(value, '外观项目库记录');
  if (!Number.isSafeInteger(record.revision) || (record.revision as number) < 0)
    fail('外观项目库版本损坏，请保留已有数据');
  const previous = record.previous === null ? null : validateAppearanceProject(record.previous);
  return {
    revision: record.revision as number,
    draft: validateAppearanceProject(record.draft),
    applied: validateAppearanceProject(record.applied),
    previous,
  };
}

function decodeStoredModel(value: unknown): AppearanceModelBlob {
  const model = object(value, '外观项目模型');
  const blob = model.blob;
  const byteLength = model.byteLength;
  const nodeCount = model.nodeCount;
  const triangleCount = model.triangleCount;
  if (
    !(blob instanceof Blob) ||
    !Number.isSafeInteger(byteLength) ||
    (byteLength as number) <= 0 ||
    blob.size !== byteLength ||
    !Number.isSafeInteger(nodeCount) ||
    (nodeCount as number) < 0 ||
    !Number.isSafeInteger(triangleCount) ||
    (triangleCount as number) < 0
  )
    fail('外观项目模型损坏，请保留已有数据');
  const checkedBlob = blob as Blob;
  return {
    id: id(model.id, '模型标识'),
    name: id(model.name, '模型名称'),
    revision: revision(model.revision, '模型版本'),
    byteLength: byteLength as number,
    nodeCount: nodeCount as number,
    triangleCount: triangleCount as number,
    blob: checkedBlob,
  };
}

function decodeModels(value: unknown): AppearanceModelBlob[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail('外观项目模型数量超限');
  const entries = value as unknown[];
  if (entries.length > MAX_GLB_MODELS) fail('外观项目模型数量超限');
  const models = entries.map(decodeStoredModel);
  if (new Set(models.map((model) => model.id)).size !== models.length) fail('外观项目模型标识重复');
  if (models.reduce((total, model) => total + model.byteLength, 0) > MAX_APPEARANCE_PACKAGE_BYTES)
    fail(`外观项目模型超过 ${MAX_APPEARANCE_PACKAGE_BYTES / 1024 / 1024} MiB`);
  return models;
}

async function validateModel(input: AppearanceModelInput): Promise<AppearanceModelBlob> {
  const model = object(input, '导入模型');
  const blob = model.blob;
  if (!(blob instanceof Blob) || !blob.size) fail('GLB 模型内容无效');
  const checkedBlob = blob as Blob;
  const stats = validateStaticGlb(await checkedBlob.arrayBuffer());
  return {
    id: id(model.id, '模型标识'),
    name: id(model.name, '模型名称'),
    revision: revision(model.revision, '模型版本'),
    byteLength: checkedBlob.size,
    nodeCount: stats.nodeCount,
    triangleCount: stats.triangleCount,
    blob: checkedBlob.slice(0, checkedBlob.size, 'model/gltf-binary'),
  };
}

async function validateModels(inputs: readonly AppearanceModelInput[]): Promise<AppearanceModelBlob[]> {
  if (inputs.length > MAX_GLB_MODELS) fail(`外观项目最多保存 ${MAX_GLB_MODELS} 个 GLB 模型`);
  const models = await Promise.all(inputs.map(validateModel));
  if (new Set(models.map((model) => model.id)).size !== models.length) fail('外观项目模型标识重复');
  if (models.reduce((total, model) => total + model.byteLength, 0) > MAX_APPEARANCE_PACKAGE_BYTES)
    fail(`外观项目模型最多保存 ${MAX_APPEARANCE_PACKAGE_BYTES / 1024 / 1024} MiB`);
  return models;
}

async function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      reject(new Error('外观项目库打开超时，请关闭其他旧版本页面后重试'));
    }, 5000);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(projectStoreName))
        request.result.createObjectStore(projectStoreName);
      if (!request.result.objectStoreNames.contains(modelsStoreName)) request.result.createObjectStore(modelsStoreName);
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
      reject(request.error ?? new Error('外观项目库无法打开'));
    };
  });
}

async function readAppearanceProject(): Promise<{ found: boolean; state: AppearanceProjectState }> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(projectStoreName, 'readonly');
      const request = transaction.objectStore(projectStoreName).get('current');
      let result = empty();
      let found = false;
      let problem: unknown;
      request.onsuccess = () => {
        try {
          found = request.result !== undefined;
          result = decodeState(request.result);
        } catch (error) {
          problem = error;
          transaction.abort();
        }
      };
      transaction.oncomplete = () => resolve({ found, state: result });
      transaction.onerror = transaction.onabort = () =>
        reject(problem ?? transaction.error ?? new Error('读取外观项目失败'));
    });
  } finally {
    database.close();
  }
}

async function migrateLegacyTerrain(state: AppearanceProjectState): Promise<AppearanceProjectState> {
  const legacy = await loadTerrainPack();
  if (!legacy.overrides.length) return state;
  const assets = resolveTerrainTextures(legacy).filter((asset) => asset.source === 'user');
  if (!assets.length) return state;
  try {
    return await saveAppearanceProject({ ...createEmptyAppearanceProject(), assets }, 0, true);
  } catch (error) {
    const latest = await readAppearanceProject();
    if (latest.found) return latest.state;
    throw error;
  }
}

export async function loadAppearanceProject(): Promise<AppearanceProjectState> {
  const current = await readAppearanceProject();
  return current.found ? current.state : migrateLegacyTerrain(current.state);
}

export async function loadAppearanceModelBlobs(): Promise<AppearanceModelBlob[]> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(modelsStoreName, 'readonly');
      const request = transaction.objectStore(modelsStoreName).get('current');
      let result: AppearanceModelBlob[] = [];
      let problem: unknown;
      request.onsuccess = () => {
        try {
          result = decodeModels(request.result);
        } catch (error) {
          problem = error;
          transaction.abort();
        }
      };
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = transaction.onabort = () =>
        reject(problem ?? transaction.error ?? new Error('读取外观项目模型失败'));
    });
  } finally {
    database.close();
  }
}

export async function loadAppearanceModelBlob(idValue: string): Promise<AppearanceModelBlob | null> {
  const modelId = id(idValue, '模型标识');
  return (await loadAppearanceModelBlobs()).find((model) => model.id === modelId) ?? null;
}

export async function saveAppearanceProject(
  project: AppearanceProject,
  expectedRevision: number,
  apply = false,
  models?: readonly AppearanceModelInput[],
): Promise<AppearanceProjectState> {
  const draft = validateAppearanceProject(project);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) fail('外观项目版本无效');
  const checkedModels = models === undefined ? undefined : await validateModels(models);
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction([projectStoreName, modelsStoreName], 'readwrite');
      const projects = transaction.objectStore(projectStoreName);
      const storedModels = transaction.objectStore(modelsStoreName);
      const request = projects.get('current');
      let result: AppearanceProjectState;
      let problem: unknown;
      request.onsuccess = () => {
        try {
          const current = decodeState(request.result);
          if (current.revision !== expectedRevision)
            fail('另一个页面已保存新外观项目。草稿未覆盖，请重新加载后再应用。');
          result = {
            revision: current.revision + 1,
            draft,
            applied: apply ? draft : current.applied,
            previous: apply ? current.applied : current.previous,
          };
          projects.put(result, 'current');
          if (checkedModels !== undefined) storedModels.put(checkedModels, 'current');
        } catch (error) {
          problem = error;
          transaction.abort();
        }
      };
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = transaction.onabort = () =>
        reject(problem ?? transaction.error ?? new Error('保存外观项目失败，原项目未改变'));
    });
  } finally {
    database.close();
  }
}

export async function restoreAppearanceProject(
  expectedRevision: number,
  mode: 'default' | 'previous',
): Promise<AppearanceProjectState> {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) fail('外观项目版本无效');
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(projectStoreName, 'readwrite');
      const store = transaction.objectStore(projectStoreName);
      const request = store.get('current');
      let result: AppearanceProjectState;
      let problem: unknown;
      request.onsuccess = () => {
        try {
          const current = decodeState(request.result);
          if (current.revision !== expectedRevision) fail('另一个页面已更新外观项目，请重新加载后恢复。');
          const target: AppearanceProject =
            mode === 'default'
              ? createEmptyAppearanceProject()
              : (current.previous ?? fail('没有可恢复的上一个已应用外观'));
          result = { revision: current.revision + 1, draft: target, applied: target, previous: current.applied };
          store.put(result, 'current');
        } catch (error) {
          problem = error;
          transaction.abort();
        }
      };
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = transaction.onabort = () =>
        reject(problem ?? transaction.error ?? new Error('恢复外观项目失败，原项目未改变'));
    });
  } finally {
    database.close();
  }
}

export async function reimportAppearanceModel(
  idValue: string,
  file: File,
  expectedRevision: number,
): Promise<AppearanceModelBlob | null> {
  const modelId = id(idValue, '模型标识');
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) fail('模型版本无效');
  const next = await validateModel({ id: modelId, name: file.name, revision: expectedRevision + 1, blob: file });
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction([projectStoreName, modelsStoreName], 'readwrite');
      const projects = transaction.objectStore(projectStoreName);
      const modelsStore = transaction.objectStore(modelsStoreName);
      const projectRequest = projects.get('current');
      const modelsRequest = modelsStore.get('current');
      let result: AppearanceModelBlob | null = null;
      let problem: unknown;
      let projectReady = false;
      let modelsReady = false;
      const commit = () => {
        if (!projectReady || !modelsReady) return;
        try {
          const current = decodeState(projectRequest.result);
          const models = decodeModels(modelsRequest.result);
          const index = models.findIndex((model) => model.id === modelId);
          if (index < 0) return;
          if (models[index].revision !== expectedRevision) fail('模型已被另一页面重导入，请重新加载后再试。');
          const total =
            models.reduce((sum, model) => sum + model.byteLength, 0) - models[index].byteLength + next.byteLength;
          if (total > MAX_APPEARANCE_PACKAGE_BYTES)
            fail(`外观项目模型最多保存 ${MAX_APPEARANCE_PACKAGE_BYTES / 1024 / 1024} MiB`);
          models[index] = next;
          modelsStore.put(models, 'current');
          projects.put({ ...current, revision: current.revision + 1 }, 'current');
          result = next;
        } catch (error) {
          problem = error;
          transaction.abort();
        }
      };
      projectRequest.onsuccess = () => {
        projectReady = true;
        commit();
      };
      modelsRequest.onsuccess = () => {
        modelsReady = true;
        commit();
      };
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = transaction.onabort = () =>
        reject(problem ?? transaction.error ?? new Error('重导入外观项目模型失败，原模型未改变'));
    });
  } finally {
    database.close();
  }
}

export async function deleteAppearanceModel(idValue: string, expectedRevision?: number): Promise<boolean> {
  const modelId = id(idValue, '模型标识');
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction([projectStoreName, modelsStoreName], 'readwrite');
      const projects = transaction.objectStore(projectStoreName);
      const modelsStore = transaction.objectStore(modelsStoreName);
      const projectRequest = projects.get('current');
      const modelsRequest = modelsStore.get('current');
      let removed = false;
      let problem: unknown;
      let projectReady = false;
      let modelsReady = false;
      const commit = () => {
        if (!projectReady || !modelsReady) return;
        try {
          const current = decodeState(projectRequest.result);
          const models = decodeModels(modelsRequest.result);
          const index = models.findIndex((model) => model.id === modelId);
          if (index < 0) return;
          if (expectedRevision !== undefined && models[index].revision !== expectedRevision)
            fail('模型已被另一页面更新，请重新加载后再删除。');
          models.splice(index, 1);
          modelsStore.put(models, 'current');
          projects.put({ ...current, revision: current.revision + 1 }, 'current');
          removed = true;
        } catch (error) {
          problem = error;
          transaction.abort();
        }
      };
      projectRequest.onsuccess = () => {
        projectReady = true;
        commit();
      };
      modelsRequest.onsuccess = () => {
        modelsReady = true;
        commit();
      };
      transaction.oncomplete = () => resolve(removed);
      transaction.onerror = transaction.onabort = () =>
        reject(problem ?? transaction.error ?? new Error('删除外观项目模型失败，原模型未改变'));
    });
  } finally {
    database.close();
  }
}

const base64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
  return btoa(binary);
};
const fromBase64 = (value: unknown): Uint8Array => {
  if (typeof value !== 'string') fail('外观包模型 base64 无效');
  const input = value as string;
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input)) fail('外观包模型 base64 无效');
  let binary: string;
  try {
    binary = atob(input);
  } catch {
    return fail('外观包模型 base64 无效');
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

export async function encodeAppearancePackage(
  project: AppearanceProject,
  models: readonly AppearanceModelInput[],
): Promise<Blob> {
  const checkedProject = validateAppearanceProject(project);
  const checkedModels = await validateModels(models);
  const text = JSON.stringify({
    schemaVersion: 1,
    project: checkedProject,
    models: await Promise.all(
      checkedModels.map(async (model) => ({
        id: model.id,
        name: model.name,
        revision: model.revision,
        blob: base64(new Uint8Array(await model.blob.arrayBuffer())),
      })),
    ),
  });
  const result = new Blob([text], { type: 'application/json' });
  if (result.size > MAX_APPEARANCE_PACKAGE_BYTES) fail(`外观包超过 ${MAX_APPEARANCE_PACKAGE_BYTES / 1024 / 1024} MiB`);
  return result;
}

export async function decodeAppearancePackage(
  blob: Blob,
): Promise<{ project: AppearanceProject; models: AppearanceModelBlob[] }> {
  if (!(blob instanceof Blob) || blob.size > MAX_APPEARANCE_PACKAGE_BYTES)
    fail(`外观包超过 ${MAX_APPEARANCE_PACKAGE_BYTES / 1024 / 1024} MiB`);
  let value: unknown;
  try {
    value = JSON.parse(await blob.text());
  } catch {
    return fail('外观包 JSON 无效');
  }
  const pack = object(value, '外观包');
  if (
    Object.keys(pack).some((key) => !['schemaVersion', 'project', 'models'].includes(key)) ||
    pack.schemaVersion !== 1
  )
    fail('外观包版本或字段无效');
  if (!Array.isArray(pack.models)) fail('外观包模型列表无效');
  const entries = pack.models as unknown[];
  const project = validateAppearanceProject(pack.project);
  const models = await validateModels(
    entries.map((entry): AppearanceModelInput => {
      const model = object(entry, '外观包模型');
      if (Object.keys(model).some((key) => !['id', 'name', 'revision', 'blob'].includes(key)))
        fail('外观包模型含未知字段');
      const bytes = fromBase64(model.blob);
      return {
        id: id(model.id, '模型标识'),
        name: id(model.name, '模型名称'),
        revision: revision(model.revision, '模型版本'),
        blob: new Blob([bytes as unknown as BlobPart], { type: 'model/gltf-binary' }),
      };
    }),
  );
  return { project, models };
}

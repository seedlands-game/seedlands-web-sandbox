import { MAX_GLB_MODELS, type StoredGlb } from '../presentation/glb-model';
import {
  createEmptyAppearanceProject,
  validateAppearanceProject,
  type AppearanceProject,
} from '../presentation/appearance-project';
import { MAX_APPEARANCE_PACKAGE_BYTES } from './appearance-model-validation';

export type AppearanceProjectState = Readonly<{
  revision: number;
  draft: AppearanceProject;
  applied: AppearanceProject;
  previous: AppearanceProject | null;
  appliedModels: readonly AppearanceModelBlob[];
  previousModels: readonly AppearanceModelBlob[];
}>;
export type AppearanceModelBlob = StoredGlb & Readonly<{ blob: Blob }>;
export type AppearanceModelInput = Readonly<{ id: string; name: string; revision: number; blob: Blob }>;

export const empty = (): AppearanceProjectState => ({
  revision: 0,
  draft: createEmptyAppearanceProject(),
  applied: createEmptyAppearanceProject(),
  previous: null,
  appliedModels: [],
  previousModels: [],
});
export const fail = (message: string): never => {
  throw new Error(message);
};
export const object = (value: unknown, label: string): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : fail(`${label}格式无效`);
export const id = (value: unknown, label: string): string =>
  typeof value === 'string' && value.trim() && value.length <= 120 ? value : fail(`${label}无效`);
export const revision = (value: unknown, label: string): number =>
  Number.isSafeInteger(value) && (value as number) >= 1 ? (value as number) : fail(`${label}无效`);

export function decodeState(value: unknown): AppearanceProjectState {
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
    appliedModels: decodeModels(record.appliedModels),
    previousModels: decodeModels(record.previousModels),
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
  return {
    id: id(model.id, '模型标识'),
    name: id(model.name, '模型名称'),
    revision: revision(model.revision, '模型版本'),
    byteLength: byteLength as number,
    nodeCount: nodeCount as number,
    triangleCount: triangleCount as number,
    blob: blob as Blob,
  };
}

export function decodeModels(value: unknown): AppearanceModelBlob[] {
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

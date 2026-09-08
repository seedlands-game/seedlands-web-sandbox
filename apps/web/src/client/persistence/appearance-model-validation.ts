import { validateStaticGlb, MAX_GLB_MODELS } from '../presentation/glb-model';
import type { AppearanceProject } from '../presentation/appearance-project';
import type { AppearanceModelBlob, AppearanceModelInput } from './appearance-project-state';

export const MAX_APPEARANCE_PACKAGE_BYTES = 96 * 1024 * 1024;
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

export async function validateModel(input: AppearanceModelInput): Promise<AppearanceModelBlob> {
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

export async function validateModels(inputs: readonly AppearanceModelInput[]): Promise<AppearanceModelBlob[]> {
  if (inputs.length > MAX_GLB_MODELS) fail(`外观项目最多保存 ${MAX_GLB_MODELS} 个 GLB 模型`);
  const models = await Promise.all(inputs.map(validateModel));
  if (new Set(models.map((model) => model.id)).size !== models.length) fail('外观项目模型标识重复');
  if (models.reduce((total, model) => total + model.byteLength, 0) > MAX_APPEARANCE_PACKAGE_BYTES)
    fail(`外观项目模型最多保存 ${MAX_APPEARANCE_PACKAGE_BYTES / 1024 / 1024} MiB`);
  return models;
}

export async function validateAnimationReferences(
  projects: readonly AppearanceProject[],
  models: readonly AppearanceModelBlob[],
) {
  const available = new Map(models.map((model) => [model.id, model]));
  const clips = new Map<string, Set<string>>();
  for (const project of projects) {
    for (const binding of Object.values(project.animationBindings ?? {})) {
      const model = available.get(binding.modelId) ?? fail(`动画绑定引用了不存在的模型：${binding.modelId}`);
      if (!clips.has(binding.modelId)) {
        const stats = validateStaticGlb(await model.blob.arrayBuffer());
        clips.set(binding.modelId, new Set(stats.animationClips.map((clip) => clip.name)));
      }
      for (const clip of Object.values(binding.clips))
        if (!clips.get(binding.modelId)!.has(clip)) fail(`动画绑定引用了不存在的片段：${clip}`);
    }
  }
}

export function withoutAnimationModel(project: AppearanceProject, modelId: string): AppearanceProject {
  return {
    ...project,
    animationBindings: Object.fromEntries(
      Object.entries(project.animationBindings ?? {}).filter(([, binding]) => binding.modelId !== modelId),
    ),
  };
}

export const base64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
  return btoa(binary);
};
export const fromBase64 = (value: unknown): Uint8Array => {
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

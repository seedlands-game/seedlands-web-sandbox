import { builtinAssets } from './asset-catalog';
import { legacyItemAssets } from './legacy-item-assets';
import type { Asset, ImageTexture, MaterialAsset, NativeAsset } from './asset-types';
import { validateNativeAssets } from './asset-package';
import { getItemDefinition } from '@seedlands/game-core/server/gameplay/item-registry';

export const appearanceAnimationTargets = ['grazer', 'night-stalker', 'settler'] as const;
export const modelAnimationRoles = ['idle', 'move', 'attack', 'hurt'] as const;
export type AppearanceAnimationTarget = (typeof appearanceAnimationTargets)[number];
export type ModelAnimationRole = (typeof modelAnimationRoles)[number];
export type AppearanceAnimationBinding = Readonly<{
  modelId: string;
  clips: Partial<Record<ModelAnimationRole, string>>;
}>;

export type AppearanceProject = {
  schemaVersion: 1;
  assets: Asset[];
  materialBindings: Record<string, Record<string, string>>;
  animationBindings?: Partial<Record<AppearanceAnimationTarget, AppearanceAnimationBinding>>;
  thumbnails: Record<string, string>;
};

const MAX_PROJECT_ASSETS = 128;
const MAX_RESOLVED_ASSETS = builtinAssets.length + MAX_PROJECT_ASSETS;
const MAX_DATA_URL_BYTES = 2 * 1024 * 1024;
const id = (value: unknown, label = '资产标识'): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > 120) throw new Error(`${label}无效`);
  return value;
};
const object = (value: unknown, label = '外观项目'): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}格式无效`);
  return value as Record<string, unknown>;
};
const exactKeys = (value: Record<string, unknown>, allowed: readonly string[], label: string) => {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error(`${label}含未知字段`);
};
const integer = (value: unknown, min: number, max: number, label: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max)
    throw new Error(`${label}无效`);
  return value as number;
};
const finite = (value: unknown, min: number, max: number, label: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    throw new Error(`${label}无效`);
  return value;
};

function dataUrl(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]*={0,2}$/.test(value))
    throw new Error(`${label}只允许 PNG/JPEG data URL`);
  const body = value.slice(value.indexOf(',') + 1);
  if (!body || body.length % 4 !== 0 || (body.match(/=/g)?.length ?? 0) > 2 || /=.+[^=]/.test(body))
    throw new Error(`${label}base64 无效`);
  const bytes = Math.floor((body.length * 3) / 4) - (body.endsWith('==') ? 2 : body.endsWith('=') ? 1 : 0);
  if (bytes > MAX_DATA_URL_BYTES) throw new Error(`${label}超过 ${MAX_DATA_URL_BYTES / 1024 / 1024} MiB`);
  return value;
}

function validateMaterial(value: Record<string, unknown>): MaterialAsset {
  exactKeys(value, ['id', 'name', 'revision', 'source', 'type', 'payload'], '材质');
  if (value.source !== 'user' || value.type !== 'material') throw new Error('外观项目只接受用户材质');
  const payload = object(value.payload, '材质');
  exactKeys(payload, ['textureId', 'renderMode', 'roughness', 'metalness', 'emissive', 'emissiveIntensity'], '材质');
  if (!Array.isArray(payload.emissive) || payload.emissive.length !== 3) throw new Error('材质自发光颜色无效');
  const emissive = payload.emissive.map((entry) => finite(entry, 0, 1, '材质自发光颜色')) as [number, number, number];
  if (!['opaque', 'cutout', 'transparent'].includes(payload.renderMode as string)) throw new Error('材质渲染模式无效');
  return {
    id: id(value.id),
    name: id(value.name, '资产名称'),
    revision: integer(value.revision, 1, Number.MAX_SAFE_INTEGER, '资产版本'),
    source: 'user',
    type: 'material',
    payload: {
      textureId: id(payload.textureId, '材质贴图标识'),
      renderMode: payload.renderMode as MaterialAsset['payload']['renderMode'],
      roughness: finite(payload.roughness, 0, 1, '材质粗糙度'),
      metalness: finite(payload.metalness, 0, 1, '材质金属度'),
      emissive,
      emissiveIntensity: finite(payload.emissiveIntensity, 0, 16, '材质自发光强度'),
    },
  };
}

function validateImage(value: Record<string, unknown>): ImageTexture {
  exactKeys(value, ['id', 'name', 'revision', 'source', 'type', 'payload'], '图片贴图');
  if (value.source !== 'user' || value.type !== 'image-texture') throw new Error('外观项目只接受用户图片贴图');
  const payload = object(value.payload, '图片贴图');
  exactKeys(payload, ['path'], '图片贴图');
  return {
    id: id(value.id),
    name: id(value.name, '资产名称'),
    revision: integer(value.revision, 1, Number.MAX_SAFE_INTEGER, '资产版本'),
    source: 'user',
    type: 'image-texture',
    payload: { path: dataUrl(payload.path, '图片贴图') },
  };
}

function preliminaryAsset(value: unknown): { type: string; value: Record<string, unknown> } {
  const entry = object(value, '资产');
  const type = entry.type;
  if (!['pixel-texture', 'extruded-pixel-model', 'material', 'image-texture'].includes(type as string))
    throw new Error('外观项目不支持该资产类型');
  if (entry.source !== 'user') throw new Error('外观项目只接受用户覆盖或新增资产');
  return { type: type as string, value: entry };
}

function mergeAssets(overrides: readonly Asset[]): Asset[] {
  const byId = new Map(builtinAssets.map((asset) => [asset.id, asset]));
  for (const asset of overrides) {
    const original = byId.get(asset.id);
    if (original && original.type !== asset.type) throw new Error('内置资产覆盖必须保持资产类型');
    byId.set(asset.id, asset);
  }
  // Old texture-only overrides retain their original grip, depth and 16px density.
  // Explicit model or new detail-texture overrides always win; never rewrite the project.
  for (const legacy of legacyItemAssets) {
    if (legacy.type !== 'extruded-pixel-model' || overrides.some((asset) => asset.id === legacy.id)) continue;
    const current = byId.get(legacy.id);
    if (current?.type !== 'extruded-pixel-model' || overrides.some((asset) => asset.id === current.payload.textureId))
      continue;
    if (overrides.some((asset) => asset.id === legacy.payload.textureId && asset.type === 'pixel-texture'))
      byId.set(legacy.id, legacy);
  }
  const merged = [
    ...builtinAssets.map((asset) => byId.get(asset.id)!),
    ...overrides.filter((asset) => !builtinAssets.some((builtin) => builtin.id === asset.id)),
  ];
  if (merged.length > MAX_RESOLVED_ASSETS) throw new Error('解析后的外观资产数量超限');
  return merged;
}

function validateReferences(assets: readonly Asset[]): void {
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const dependencies = new Map<string, string[]>();
  for (const asset of assets) {
    const refs =
      asset.type === 'extruded-pixel-model' || asset.type === 'material'
        ? [asset.payload.textureId]
        : 'materialIds' in asset.payload
          ? asset.payload.materialIds
          : [];
    for (const reference of refs) {
      const target = byId.get(reference);
      if (!target) throw new Error(`资产 ${asset.id} 引用了不存在的资产`);
      if (asset.type === 'extruded-pixel-model' && target.type !== 'pixel-texture')
        throw new Error('像素模型只能引用像素贴图');
      if (asset.type === 'material' && target.type !== 'pixel-texture')
        throw new Error('当前运行材质只支持16/32/64像素源；图片可作为独立美术图像管理');
      if ('materialIds' in asset.payload && target.type !== 'material') throw new Error('模型只能引用材质');
    }
    dependencies.set(asset.id, refs);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (assetId: string) => {
    if (visiting.has(assetId)) throw new Error('资产引用存在循环');
    if (visited.has(assetId)) return;
    visiting.add(assetId);
    for (const dependency of dependencies.get(assetId) ?? []) visit(dependency);
    visiting.delete(assetId);
    visited.add(assetId);
  };
  for (const asset of assets) visit(asset.id);
}

export function createEmptyAppearanceProject(): AppearanceProject {
  return { schemaVersion: 1, assets: [], materialBindings: {}, animationBindings: {}, thumbnails: {} };
}

export function validateAppearanceProject(value: unknown): AppearanceProject {
  const project = object(value);
  exactKeys(project, ['schemaVersion', 'assets', 'materialBindings', 'animationBindings', 'thumbnails'], '外观项目');
  if (project.schemaVersion !== 1 || !Array.isArray(project.assets) || project.assets.length > MAX_PROJECT_ASSETS)
    throw new Error('外观项目版本或资产数量无效');
  const preliminary = project.assets.map(preliminaryAsset);
  const ids = preliminary.map(({ value: entry }) => id(entry.id));
  if (new Set(ids).size !== ids.length) throw new Error('外观项目资产标识重复');
  const mergedNative = mergeAssets(
    preliminary
      .filter((entry) => entry.type === 'pixel-texture' || entry.type === 'extruded-pixel-model')
      .map((entry) => entry.value as NativeAsset),
  ).filter((asset): asset is NativeAsset => asset.type === 'pixel-texture' || asset.type === 'extruded-pixel-model');
  const checkedNative = new Map(
    validateNativeAssets(
      mergedNative,
      true,
      builtinAssets.filter((asset) => asset.type === 'pixel-texture' || asset.type === 'extruded-pixel-model').length,
    ).map((asset) => [asset.id, asset]),
  );
  const assets = preliminary.map(({ type, value: entry }): Asset => {
    if (type === 'pixel-texture' || type === 'extruded-pixel-model') return checkedNative.get(id(entry.id))!;
    return type === 'material' ? validateMaterial(entry) : validateImage(entry);
  });
  const merged = mergeAssets(assets);
  validateReferences(merged);
  for (const asset of assets) {
    const builtin = builtinAssets.find((candidate) => candidate.id === asset.id);
    if (
      asset.type === 'material' &&
      builtin?.type === 'material' &&
      asset.payload.renderMode !== builtin.payload.renderMode
    )
      throw new Error('当前材质必须保留原透明批次类型');
  }

  const bindings = object(project.materialBindings, '材质绑定');
  const materialBindings: Record<string, Record<string, string>> = {};
  const byId = new Map(merged.map((asset) => [asset.id, asset]));
  for (const [modelId, binding] of Object.entries(bindings)) {
    const model = byId.get(id(modelId, '模型标识'));
    if (!model || !('materialIds' in model.payload)) throw new Error('材质绑定模型不存在或不支持材质槽');
    if (
      model.type === 'builtin-voxel-model' ||
      (model.type === 'builtin-item-model' && getItemDefinition(model.payload.itemId).placesVoxel !== undefined)
    )
      throw new Error('方块外观使用共享面材质，不能应用对象专用绑定');
    const slots = object(binding, '材质绑定');
    materialBindings[modelId] = {};
    for (const [originalMaterialId, overrideMaterialId] of Object.entries(slots)) {
      if (!model.payload.materialIds.includes(originalMaterialId)) throw new Error('材质绑定槽位不属于该模型');
      const override = byId.get(id(overrideMaterialId, '覆盖材质标识'));
      if (override?.type !== 'material') throw new Error('材质绑定目标必须是材质');
      materialBindings[modelId][originalMaterialId] = override.id;
    }
  }

  const rawAnimationBindings =
    project.animationBindings === undefined ? {} : object(project.animationBindings, '动画绑定');
  const animationBindings: Partial<Record<AppearanceAnimationTarget, AppearanceAnimationBinding>> = {};
  for (const [target, value] of Object.entries(rawAnimationBindings)) {
    if (!appearanceAnimationTargets.includes(target as AppearanceAnimationTarget)) throw new Error('动画绑定目标无效');
    const binding = object(value, '动画绑定');
    exactKeys(binding, ['modelId', 'clips'], '动画绑定');
    const clips = object(binding.clips, '动画绑定片段');
    exactKeys(clips, modelAnimationRoles, '动画绑定片段');
    const checkedClips: Partial<Record<ModelAnimationRole, string>> = {};
    for (const [role, clip] of Object.entries(clips))
      checkedClips[role as ModelAnimationRole] = id(clip, '动画片段名称');
    if (!Object.keys(checkedClips).length) throw new Error('动画绑定至少需要一个片段');
    animationBindings[target as AppearanceAnimationTarget] = {
      modelId: id(binding.modelId, '动画绑定模型标识'),
      clips: checkedClips,
    };
  }

  const rawThumbnails = object(project.thumbnails, '缩略图');
  const thumbnails: Record<string, string> = {};
  if (Object.keys(rawThumbnails).length > MAX_PROJECT_ASSETS) throw new Error('缩略图数量超限');
  for (const [assetId, thumbnail] of Object.entries(rawThumbnails)) {
    if (!byId.has(id(assetId))) throw new Error('缩略图引用不存在的资产');
    thumbnails[assetId] = dataUrl(thumbnail, '缩略图');
  }
  return { schemaVersion: 1, assets, materialBindings, animationBindings, thumbnails };
}

export function resolveAppearanceAssets(project: AppearanceProject, modelId?: string): Asset[] {
  const checked = validateAppearanceProject(project);
  const resolved = mergeAssets(checked.assets);
  if (!modelId) return resolved;
  const bindings = checked.materialBindings[modelId];
  if (!bindings) return resolved;
  const byId = new Map(Object.entries(bindings));
  return resolved.map((asset) => {
    const overrideId = byId.get(asset.id);
    if (!overrideId) return asset;
    const override = resolved.find((candidate) => candidate.id === overrideId);
    return override && override.type === 'material' ? { ...override, id: asset.id } : asset;
  });
}

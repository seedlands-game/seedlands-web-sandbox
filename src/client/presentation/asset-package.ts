import type { Asset, NativeAsset, PixelTexture, ToolModel, Rgb } from './asset-types';
import { isNativeAsset, assetDependencies } from './asset-adapters';

const fail = (message: string): never => {
  throw new Error(message);
};
const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : fail('资产结构必须是对象');
const keys = (value: Record<string, unknown>, allowed: string[]) => {
  if (Object.keys(value).some((key) => !allowed.includes(key))) fail('资产含未知字段或游戏绑定');
};
const integer = (value: unknown, min: number, max: number): number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
    ? value
    : fail('整数超出允许范围');
const string = (value: unknown): string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 120 ? value : fail('名称或标识无效');

export function validateNativeAssets(input: unknown): NativeAsset[] {
  if (!Array.isArray(input) || input.length > 128) fail('资产数量超限');
  const assets: NativeAsset[] = (input as unknown[]).map((entry) => {
    const a = record(entry);
    keys(a, ['id', 'name', 'revision', 'source', 'type', 'payload']);
    const base = {
      id: string(a.id),
      name: string(a.name),
      revision: integer(a.revision, 1, Number.MAX_SAFE_INTEGER),
      source: 'user' as const,
    };
    if (a.source !== 'user') fail('只能导入用户资产副本');
    const p = record(a.payload);
    if (a.type === 'pixel-texture') {
      keys(p, ['width', 'height', 'palette', 'pixels']);
      const width = integer(p.width, 16, 64),
        height = integer(p.height, 16, 64);
      if (![16, 32, 64].includes(width) || width !== height) fail('只支持16/32/64方形像素画布');
      if (!Array.isArray(p.palette) || p.palette.length < 2 || p.palette.length > 32) fail('调色板需要2到32色');
      const palette = (p.palette as unknown[]).map((color): Rgb => {
        if (!Array.isArray(color) || color.length !== 3) fail('颜色必须为RGB');
        return (color as unknown[]).map((c) => integer(c, 0, 255)) as Rgb;
      });
      if (!Array.isArray(p.pixels) || p.pixels.length !== width * height) fail('像素数量不匹配');
      const pixels = (p.pixels as unknown[]).map((c) => integer(c, 0, palette.length - 1));
      return { ...base, type: 'pixel-texture', payload: { width, height, palette, pixels } };
    }
    if (a.type !== 'extruded-pixel-model') fail('暂不支持该资产类型导入');
    keys(p, ['textureId', 'thicknessPixels', 'grip', 'generatorVersion']);
    if (p.generatorVersion !== 1) fail('不支持该生成器版本');
    if (
      !Array.isArray(p.grip) ||
      p.grip.length !== 2 ||
      p.grip.some((n) => typeof n !== 'number' || !Number.isFinite(n))
    )
      fail('握持点无效');
    return {
      ...base,
      type: 'extruded-pixel-model',
      payload: {
        textureId: string(p.textureId),
        thicknessPixels: integer(p.thicknessPixels, 1, 8),
        grip: [...(p.grip as [number, number])],
        generatorVersion: 1,
      },
    };
  });
  if (new Set(assets.map((a) => a.id)).size !== assets.length) fail('资产标识重复');
  for (const asset of assets)
    if (asset.type === 'extruded-pixel-model') {
      const texture = assets.find((a) => a.id === asset.payload.textureId);
      if (texture?.type !== 'pixel-texture') fail('模型缺少像素贴图依赖');
      if (
        asset.payload.grip.some(
          (v, i) =>
            v < 0 || v > (i === 0 ? (texture as PixelTexture).payload.width : (texture as PixelTexture).payload.height),
        )
      )
        fail('握持点超出画布');
    }
  return assets;
}

export function parseAssetPackage(text: string): NativeAsset[] {
  if (new TextEncoder().encode(text).length > 2 * 1024 * 1024) fail('资产包超过2 MiB');
  const pack = record(JSON.parse(text));
  keys(pack, ['schemaVersion', 'assets']);
  if (pack.schemaVersion !== 1) fail('不支持该资产包版本');
  return validateNativeAssets(pack.assets);
}

export function assetBundle(id: string, assets: readonly Asset[]): NativeAsset[] {
  const asset = assets.find((a) => a.id === id);
  if (!asset || !isNativeAsset(asset)) return fail('此资产暂不支持原生工程导出');
  const dependencies = assetDependencies(asset).flatMap((dependency) => assetBundle(dependency, assets));
  return [...dependencies, asset];
}
export function copyAssetBundle(id: string, assets: readonly Asset[], newId: () => string): NativeAsset[] {
  return remapAssetBundle(assetBundle(id, assets), newId);
}
export function remapAssetBundle(input: readonly NativeAsset[], newId: () => string): NativeAsset[] {
  const ids = new Map(input.map((a) => [a.id, newId()]));
  return input.map((original) => {
    const asset = structuredClone(original);
    asset.id = ids.get(original.id)!;
    asset.source = 'user';
    asset.revision = 1;
    if (asset.type === 'extruded-pixel-model') asset.payload.textureId = ids.get(asset.payload.textureId)!;
    return asset;
  });
}

export function resolvePixelModel(asset: Asset, assets: readonly Asset[]): ToolModel {
  if (asset.type !== 'extruded-pixel-model') return fail('不是像素挤出模型');
  const texture = assets.find((a) => a.id === asset.payload.textureId);
  if (texture?.type !== 'pixel-texture') return fail('找不到像素贴图');
  const { width, height, palette, pixels } = texture.payload;
  const symbols = '.abcdefghijklmnopqrstuvwxyzABCDE';
  return {
    pixels: Array.from({ length: height }, (_, y) =>
      pixels
        .slice(y * width, (y + 1) * width)
        .map((i) => symbols[i])
        .join(''),
    ),
    palette: Object.fromEntries(palette.map((color, i) => [symbols[i], color])),
    grip: asset.payload.grip,
    thicknessPixels: asset.payload.thicknessPixels,
  };
}

import { getItemDefinition } from '@seedlands/game-core/server/gameplay/item-registry';
import type { Asset, MaterialAsset, PixelTexture } from '../../client/presentation/asset-types';
import type { GlbModelStats, StoredGlb } from '../../client/presentation/glb-model';
import { inspectStoredGlb } from '../../client/persistence/glb-model-store';

export type AppearanceResourceCategory = 'model' | 'material' | 'image';

export function appearanceResourceCategory(asset: Asset): AppearanceResourceCategory {
  if (asset.type === 'material') return 'material';
  if (asset.type === 'pixel-texture' || asset.type === 'image-texture') return 'image';
  return 'model';
}

export const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export const sharedMaterialNote = (asset: Asset | undefined): string =>
  asset?.id === 'builtin:model:lantern'
    ? '灯笼材质在模型、放置、手持和掉落表现中共享，编辑会同步这四种上下文。'
    : '此方块材质与放置表现共享，编辑会同步全部引用。';

export async function inspectGlbModel(modelId: string): Promise<GlbModelStats | string> {
  try {
    return await inspectStoredGlb(modelId);
  } catch (error) {
    return errorMessage(error);
  }
}

export const glbModelAssets = (models: readonly StoredGlb[]): Asset[] =>
  models.map((model) => ({
    id: model.id,
    name: model.name,
    revision: model.revision,
    source: 'user',
    type: 'glb-model',
    payload: {
      modelId: model.id,
      byteLength: model.byteLength,
      nodeCount: model.nodeCount,
      triangleCount: model.triangleCount,
    },
  }));

export function focusedPixelTexture(
  assets: readonly Asset[],
  focus: Asset | undefined,
  material: MaterialAsset | undefined,
): PixelTexture | undefined {
  if (focus?.type === 'pixel-texture') return focus;
  const source = material ?? (focus?.type === 'material' ? focus : undefined);
  if (!source) return undefined;
  return assets.find(
    (asset): asset is PixelTexture => asset.id === source.payload.textureId && asset.type === 'pixel-texture',
  );
}

export function canMakeMaterialsPrivate(asset: Asset | undefined): boolean {
  if (!asset || asset.id === 'builtin:model:lantern') return false;
  if (asset.type === 'builtin-actor-model' || asset.type === 'builtin-arm-model') return true;
  return asset.type === 'builtin-item-model' && getItemDefinition(asset.payload.itemId).placesVoxel === undefined;
}

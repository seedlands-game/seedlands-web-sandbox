import type { Asset, MaterialAsset } from './asset-types';
import { builtinItemBindings } from './asset-catalog';
import { assetDependencies } from './asset-adapters';
import { getItemDefinition } from '../../server/gameplay/item-registry';

export type AppearanceContext = { name: string; assetId: string; mode: 'model' | 'held' };
export type AppearanceObject = { id: string; name: string; contexts: AppearanceContext[] };
export const assetCategory = (asset: Asset): 'model' | 'material' | 'image' =>
  asset.type === 'material'
    ? 'material'
    : asset.type === 'pixel-texture' || asset.type === 'image-texture'
      ? 'image'
      : 'model';

export function appearanceObjects(assets: readonly Asset[]): AppearanceObject[] {
  const used = new Set<string>();
  const objects: AppearanceObject[] = [];
  for (const binding of builtinItemBindings) {
    if (!assets.some((asset) => asset.id === binding.modelId)) continue;
    used.add(binding.modelId);
    const contexts: AppearanceContext[] = [{ name: '模型', assetId: binding.modelId, mode: 'model' }];
    const voxel = getItemDefinition(binding.itemId).placesVoxel;
    const placedId = `seedlands:model/voxel/${voxel}`;
    if (voxel !== undefined && assets.some((asset) => asset.id === placedId)) {
      used.add(placedId);
      contexts.push({ name: '放置', assetId: placedId, mode: 'model' });
    }
    contexts.push(
      { name: '手持', assetId: binding.modelId, mode: 'held' },
      { name: '掉落', assetId: binding.modelId, mode: 'model' },
    );
    objects.push({ id: binding.modelId, name: binding.name, contexts });
  }
  for (const asset of assets) {
    if (assetCategory(asset) !== 'model' || used.has(asset.id)) continue;
    objects.push({ id: asset.id, name: asset.name, contexts: [{ name: '模型', assetId: asset.id, mode: 'model' }] });
  }
  return objects;
}

export function materialSlots(asset: Asset, assets: readonly Asset[]): MaterialAsset[] {
  if (asset.type === 'material') return [asset];
  const dependencies = assetDependencies(asset);
  return assets.filter(
    (candidate): candidate is MaterialAsset => candidate.type === 'material' && dependencies.includes(candidate.id),
  );
}

export function dependencyUsers(id: string, assets: readonly Asset[]): Asset[] {
  const found = new Set([id]);
  let size = 0;
  while (size !== found.size) {
    size = found.size;
    for (const asset of assets)
      if (assetDependencies(asset).some((dependency) => found.has(dependency))) found.add(asset.id);
  }
  return assets.filter((asset) => asset.id !== id && found.has(asset.id));
}

<script lang="ts">
  import type { Asset } from '../../client/presentation/asset-types';
  import { builtinBinding } from '../../client/presentation/asset-catalog';
  import { publicAssetUrl } from '../../client/presentation/public-asset-url';
  import { pixelImageUrl, itemIconUrl } from '../gameplay/asset-image';
  let { asset, assets, revision = 0 }: { asset: Asset; assets: Asset[]; revision?: number } = $props();
  const url = $derived.by(() => {
    revision;
    if (asset.type === 'pixel-texture') return pixelImageUrl(asset);
    if (asset.type === 'image-texture') return publicAssetUrl(import.meta.env.BASE_URL, asset.payload.path);
    if (asset.type === 'builtin-item-model' && builtinBinding(asset.payload.itemId))
      return itemIconUrl(asset.payload.itemId, import.meta.env.BASE_URL);
    if (asset.type === 'material' || asset.type === 'extruded-pixel-model') {
      const texture = assets.find((a) => a.id === asset.payload.textureId);
      if (texture?.type === 'pixel-texture') return pixelImageUrl(texture);
    }
    if (asset.type === 'builtin-voxel-model') {
      const material = assets.find((a) => a.id === asset.payload.materialIds[0]);
      if (material?.type === 'material') {
        const texture = assets.find((a) => a.id === material.payload.textureId);
        if (texture?.type === 'pixel-texture') return pixelImageUrl(texture);
      }
    }
    return '';
  });
</script>

<div class="thumbnail">
  {#if url}<img src={url} alt="" />{:else}<span
      >{asset.type === 'builtin-actor-model' ? '♟' : asset.type === 'builtin-arm-model' ? '▥' : '3D'}</span
    >{/if}
</div>

<style>
  .thumbnail {
    width: 42px;
    height: 42px;
    display: grid;
    place-items: center;
    flex-shrink: 0;
    background: #101b18;
    border: 1px solid #3a4940;
    border-radius: 7px;
  }
  img {
    width: 32px;
    height: 32px;
    object-fit: contain;
    image-rendering: pixelated;
  }
</style>

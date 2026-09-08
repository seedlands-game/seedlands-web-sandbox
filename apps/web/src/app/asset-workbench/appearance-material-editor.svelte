<script lang="ts">
  import type { Asset, MaterialAsset } from '../../client/presentation/asset-types';

  let {
    modelId,
    slots,
    assets,
    allowPrivate,
    onprivate,
    onedit,
    ontexture,
  }: {
    modelId: string;
    slots: MaterialAsset[];
    assets: Asset[];
    allowPrivate: boolean;
    onprivate: (slot: MaterialAsset) => void;
    onedit: (slot: MaterialAsset, field: 'roughness' | 'metalness' | 'emissiveIntensity', value: number) => void;
    ontexture: (asset: Asset, preserveObject?: boolean) => void;
  } = $props();

  const textureFor = (material: MaterialAsset) => assets.find((asset) => asset.id === material.payload.textureId);
</script>

<section class="materials" aria-label="模型材质">
  <div class="heading">
    <div>
      <span>模型材质</span>
      <h2>{slots.length} 个槽位</h2>
    </div>
    <small>{modelId}</small>
  </div>
  {#each slots as slot (slot.id)}
    {@const texture = textureFor(slot)}
    <article>
      <div class="title">
        <strong>{slot.name}</strong>{#if allowPrivate}<button onclick={() => onprivate(slot)}
            >建立此对象的专用副本</button
          >{/if}
      </div>
      <label
        >粗糙度 <input
          aria-label={`${slot.name} 粗糙度`}
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={slot.payload.roughness}
          onchange={(event) => onedit(slot, 'roughness', Number(event.currentTarget.value))}
        /><output>{slot.payload.roughness.toFixed(2)}</output></label
      >
      <label
        >金属度 <input
          aria-label={`${slot.name} 金属度`}
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={slot.payload.metalness}
          onchange={(event) => onedit(slot, 'metalness', Number(event.currentTarget.value))}
        /><output>{slot.payload.metalness.toFixed(2)}</output></label
      >
      <label
        >发光 <input
          aria-label={`${slot.name} 发光强度`}
          type="range"
          min="0"
          max="16"
          step="0.1"
          value={slot.payload.emissiveIntensity}
          onchange={(event) => onedit(slot, 'emissiveIntensity', Number(event.currentTarget.value))}
        /><output>{slot.payload.emissiveIntensity.toFixed(1)}</output></label
      >
      {#if texture}<button class="texture" onclick={() => ontexture(texture, true)}>编辑贴图：{texture.name}</button
        >{/if}
    </article>
  {:else}
    <p>此对象没有可编辑的材质槽位。</p>
  {/each}
</section>

<style>
  .materials {
    display: grid;
    gap: 10px;
  }
  .heading,
  .title {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 9px;
  }
  .heading span,
  small,
  p {
    color: #9daf9f;
    font-size: 11px;
  }
  h2 {
    margin: 2px 0 0;
    font-size: 15px;
  }
  article {
    padding: 12px;
    border: 1px solid #3e5045;
    border-radius: 8px;
    background: #17231d;
  }
  .title {
    margin-bottom: 9px;
  }
  .title button {
    font-size: 10px;
    padding: 5px 7px;
  }
  label {
    display: grid;
    grid-template-columns: 52px 1fr 36px;
    align-items: center;
    gap: 8px;
    margin: 8px 0;
    color: #b8c4b7;
    font-size: 11px;
  }
  input {
    width: 100%;
  }
  output {
    color: #d4c38e;
    font-size: 11px;
    text-align: right;
  }
  .texture {
    width: 100%;
    margin-top: 5px;
    background: #21352a;
    text-align: left;
    font-size: 11px;
  }
</style>

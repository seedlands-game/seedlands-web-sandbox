<script lang="ts">
  import { onMount } from 'svelte';
  import type { PixelTexture } from '../../client/presentation/asset-types';
  import { terrainMaterials, terrainMaterial } from '../../client/presentation/terrain-assets';
  import {
    loadTerrainPack,
    saveTerrainPack,
    resolveTerrainTextures,
    type TerrainPack,
  } from '../../client/persistence/terrain-pack-store';
  import { compileTextureAtlas } from '../../client/presentation/texture-pack';
  let { texture, textures, onapplied }: { texture?: PixelTexture; textures: PixelTexture[]; onapplied: () => void } =
    $props();
  let pack = $state<TerrainPack | null>(null);
  let target = $state(3);
  let pending = $state(false);
  let status = $state('');
  let failed = $state(false);
  let exported = $state<{ png: string; json: string; revision: number; count: number } | null>(null);
  let exportGeneration = 0;
  function releaseExport() {
    if (exported) {
      URL.revokeObjectURL(exported.png);
      URL.revokeObjectURL(exported.json);
      exported = null;
    }
  }
  async function reload() {
    try {
      pack = await loadTerrainPack();
      status = '';
      failed = false;
    } catch (error) {
      status = String(error);
      failed = true;
    }
  }
  onMount(() => {
    void reload();
    return () => {
      exportGeneration++;
      releaseExport();
    };
  });
  async function apply(reset = false) {
    if (!pack || (!reset && !texture)) return;
    pending = true;
    try {
      const overrides = pack.overrides.filter((entry) => entry.faceMaterial !== target);
      if (!reset && texture) overrides.push({ faceMaterial: target, texture: structuredClone(texture) });
      pack = await saveTerrainPack(overrides, pack.contentRevision);
      status = reset
        ? '已恢复此材质的默认贴图。重新进入游戏后生效。'
        : '已应用当前快照。重新进入游戏后生效；继续编辑草稿不会改变此版本。';
      failed = false;
      onapplied();
    } catch (error) {
      status = error instanceof Error ? error.message : String(error);
      failed = true;
    } finally {
      pending = false;
    }
  }
  async function exportAtlas() {
    if (!pack) return;
    const generation = ++exportGeneration;
    const contentRevision = pack.contentRevision;
    try {
      const terrain = resolveTerrainTextures(pack);
      const sources = structuredClone([
        ...textures.filter((source) => !terrain.some((replacement) => replacement.id === source.id)),
        ...terrain,
      ]).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      const atlas = compileTextureAtlas(sources);
      const canvas = document.createElement('canvas');
      canvas.width = atlas.width;
      canvas.height = atlas.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('无法生成图集画布');
      context.putImageData(new ImageData(new Uint8ClampedArray(atlas.pixels), atlas.width, atlas.height), 0, 0);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((value) => (value ? resolve(value) : reject(new Error('图集导出失败'))), 'image/png'),
      );
      if (generation !== exportGeneration) return;
      releaseExport();
      const { pixels: _pixels, ...index } = atlas;
      const indexBlob = new Blob(
        [
          JSON.stringify(
            {
              format: 'seedlands-texture-atlas',
              schemaVersion: 1,
              contentRevision,
              style: 'pixel16',
              atlas: index,
              materials: terrainMaterials,
              sources,
            },
            null,
            2,
          ),
        ],
        { type: 'application/json' },
      );
      exported = {
        png: URL.createObjectURL(blob),
        json: URL.createObjectURL(indexBlob),
        revision: contentRevision,
        count: sources.length,
      };
      status = '图集已生成。分别下载 PNG 和索引/源数据；继续编辑不会改变本次生成结果。';
      failed = false;
    } catch (error) {
      status = String(error);
      failed = true;
    }
  }
</script>

<section class="pack-panel" aria-label="地形资源包">
  <div class="heading">
    <h2>地形资源包</h2>
    <span>pixel16 · r{pack?.contentRevision ?? 0}</span>
  </div>
  <p>当前 {pack?.overrides.length ?? 0} 项覆盖。应用保存独立快照，普通保存仍保留在草稿库。</p>
  <label
    >目标材质 <select aria-label="应用目标材质" bind:value={target}>
      {#each terrainMaterials as material (material.id)}<option value={material.faceMaterial}>{material.name}</option
        >{/each}
    </select></label
  >
  <div class="buttons">
    <button disabled={!pack || pending || !texture || texture.payload.width !== 16} onclick={() => apply()}
      >应用贴图到游戏</button
    >
    <button
      disabled={!pack || pending || !pack.overrides.some((entry) => entry.faceMaterial === target)}
      onclick={() => apply(true)}>恢复此材质默认</button
    >
    <button disabled={!pack || pending} onclick={exportAtlas}>导出图集与索引</button>
    <button disabled={pending} onclick={reload}>刷新包状态</button>
  </div>
  {#if pack?.overrides.length}<div class="overrides">
      {#each pack.overrides as entry (entry.faceMaterial)}<span
          >{terrainMaterial(entry.faceMaterial)?.name} ← {entry.texture.name}</span
        >{/each}
    </div>{/if}
  {#if texture && texture.payload.width !== 16}<p>此贴图保留原尺寸；地形基础面需要 16×16。</p>{/if}
  {#if exported}<div class="atlas-export">
      <img src={exported.png} alt="编译后的纹理图集" />
      <p>{exported.count} 张源贴图 · 包 r{exported.revision} 快照</p>
      <a href={exported.png} download="seedlands-textures.png">下载图集 PNG</a><a
        href={exported.json}
        download="seedlands-textures.json">下载索引与源数据</a
      >
    </div>{/if}
  {#if status}<p class:error={failed} role={failed ? 'alert' : 'status'}>{status}</p>{/if}
  <a href={import.meta.env.BASE_URL} target="_blank" rel="noreferrer">打开游戏试玩 ↗</a>
</section>

<style>
  .atlas-export img {
    width: 100%;
    max-width: 220px;
    image-rendering: pixelated;
    margin-top: 12px;
  }
  .atlas-export a {
    display: inline-block;
    margin: 6px 12px 6px 0;
  }
  .pack-panel {
    margin-top: 20px;
    padding: 16px;
    border: 1px solid #48523e;
    border-radius: 10px;
    background: #1c2721;
  }
  .heading {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
  }
  h2 {
    font-size: 14px;
    margin: 0;
  }
  span,
  p,
  a,
  label {
    font-size: 12px;
  }
  p {
    color: #aabbab;
    line-height: 1.6;
  }
  .buttons,
  .overrides {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin: 12px 0;
  }
  .overrides span {
    padding: 5px;
    background: #2b392e;
    border-radius: 4px;
  }
  .error {
    color: #ffb3a4;
  }
  a {
    color: #d6c189;
  }
</style>

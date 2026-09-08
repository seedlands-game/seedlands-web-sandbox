<script lang="ts">
  import type { PixelTexture } from '../../client/presentation/asset-types';
  import { compileTextureAtlas } from '../../client/presentation/texture-pack';

  let { textures }: { textures: PixelTexture[] } = $props();
  let pending = $state(false);
  let status = $state('');
  let error = $state(false);
  let exported = $state<{ png: string; json: string; count: number } | null>(null);

  function clear() {
    if (!exported) return;
    URL.revokeObjectURL(exported.png);
    URL.revokeObjectURL(exported.json);
    exported = null;
  }
  async function exportAtlas() {
    if (pending) return;
    pending = true;
    try {
      const atlas = compileTextureAtlas(structuredClone(textures));
      const canvas = document.createElement('canvas');
      canvas.width = atlas.width;
      canvas.height = atlas.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('图集画布不可用');
      context.putImageData(new ImageData(new Uint8ClampedArray(atlas.pixels), atlas.width, atlas.height), 0, 0);
      const png = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('图集编码失败'))), 'image/png'),
      );
      clear();
      const { pixels: _pixels, ...index } = atlas;
      exported = {
        png: URL.createObjectURL(png),
        json: URL.createObjectURL(
          new Blob([JSON.stringify({ schemaVersion: 1, atlas: index }, null, 2)], { type: 'application/json' }),
        ),
        count: textures.length,
      };
      status = '图集与索引已生成；它们是可再生成的派生产物，不会修改编辑源。';
      error = false;
    } catch (cause) {
      status = cause instanceof Error ? cause.message : String(cause);
      error = true;
    } finally {
      pending = false;
    }
  }
</script>

<section class="atlas-export">
  <h3>派生图集</h3>
  <p>从当前 {textures.length} 张像素源编译，不会写入项目。</p>
  <button disabled={pending || !textures.length} onclick={exportAtlas}
    >{pending ? '正在生成…' : '导出图集与索引'}</button
  >
  {#if exported}<p>{exported.count} 张源贴图</p>
    <a href={exported.png} download="seedlands-appearance-atlas.png">下载图集 PNG</a><a
      href={exported.json}
      download="seedlands-appearance-atlas.json">下载索引 JSON</a
    >{/if}
  {#if status}<p class:error role={error ? 'alert' : 'status'}>{status}</p>{/if}
</section>

<style>
  .atlas-export {
    border-top: 1px solid #3c4a40;
    margin-top: 18px;
    padding-top: 4px;
  }
  .atlas-export h3 {
    font-size: 13px;
    margin: 18px 0 9px;
  }
  .atlas-export p,
  .atlas-export a {
    color: #9daf9f;
    font-size: 11px;
  }
  .atlas-export a {
    display: block;
    color: #d9c17e;
    margin: 5px 0;
  }
  .atlas-export p.error {
    color: #ffb3a4;
  }
</style>

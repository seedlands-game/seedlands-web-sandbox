<script lang="ts">
  import { onMount } from 'svelte';
  import type { Asset } from '../../client/presentation/asset-types';
  import { PreviewScene } from './preview-scene';
  let {
    asset,
    assets,
    revision,
    contextMode,
  }: { asset: Asset; assets: Asset[]; revision: number; contextMode?: 'model' | 'held' } = $props();
  let canvas: HTMLCanvasElement;
  let scene = $state<PreviewScene | null>(null);
  let mode = $state<'model' | 'held'>('model');
  let filtering = $state<'nearest' | 'linear'>('nearest');
  let repeat = $state(1);
  let error = $state('');
  let ready = $state(false);
  let dragging = false;
  let previous = [0, 0];
  let request = 0;
  onMount(() => {
    try {
      scene = new PreviewScene(canvas);
    } catch (e) {
      error = `3D 不可用：${e instanceof Error ? e.message : String(e)}`;
    }
    const hide = (event: PageTransitionEvent) => {
      if (!event.persisted) scene?.dispose();
    };
    window.addEventListener('pagehide', hide);
    return () => {
      window.removeEventListener('pagehide', hide);
      request++;
      scene?.dispose();
    };
  });
  $effect(() => {
    revision;
    const current = ++request;
    if (scene) {
      error = '';
      ready = false;
      void scene
        .show(asset, assets, contextMode ?? mode, filtering, repeat)
        .then(() => {
          if (current === request) ready = true;
        })
        .catch((e: unknown) => {
          if (current === request) error = `无法预览：${e instanceof Error ? e.message : String(e)}`;
        });
    }
  });
</script>

<div class="preview-toolbar">
  <strong>实时预览</strong>
  {#if !contextMode && (asset.type === 'extruded-pixel-model' || asset.type === 'builtin-item-model')}
    <select aria-label="预览模式" bind:value={mode}
      ><option value="model">模型检视</option><option value="held">第一人称手持</option></select
    >
  {/if}
  <button onclick={() => scene?.reset()}>复位视角</button>
</div>
<div class="viewport" data-ready={ready} data-type={asset.type}>
  <canvas
    bind:this={canvas}
    aria-label="3D 资产预览，拖动旋转，滚轮缩放"
    tabindex="0"
    onpointerdown={(event) => {
      dragging = true;
      previous = [event.clientX, event.clientY];
      canvas.setPointerCapture(event.pointerId);
    }}
    onpointermove={(event) => {
      if (dragging) scene?.orbit(event.clientX - previous[0], event.clientY - previous[1]);
      previous = [event.clientX, event.clientY];
    }}
    onpointerup={() => (dragging = false)}
    onpointercancel={() => (dragging = false)}
    onwheel={(event) => {
      event.preventDefault();
      scene?.zoom(event.deltaY);
    }}
    onkeydown={(event) => {
      if (event.key.startsWith('Arrow')) event.preventDefault();
      if (event.key === 'ArrowLeft') scene?.orbit(-10, 0);
      if (event.key === 'ArrowRight') scene?.orbit(10, 0);
      if (event.key === 'ArrowUp') scene?.orbit(0, -10);
      if (event.key === 'ArrowDown') scene?.orbit(0, 10);
      if (event.key === '+' || event.key === '=') scene?.zoom(-100);
      if (event.key === '-') scene?.zoom(100);
    }}
  ></canvas>
  {#if error}<p class="preview-error" role="alert">{error}</p>{/if}
  <span class="view-label">{(contextMode ?? mode) === 'held' ? '共享游戏手持表现' : '拖动旋转 · 滚轮缩放'}</span>
</div>
{#if (contextMode ?? mode) === 'held'}
  <div class="action-strip">
    <button onclick={() => scene?.action('attack')}>挥动</button>
    <button onclick={() => scene?.action('mine')}>连续采集</button>
    <button onclick={() => scene?.action('idle')}>停止收手</button>
  </div>
{:else if asset.type === 'image-texture' || asset.type === 'pixel-texture'}
  <div class="action-strip">
    <label
      >采样对照 <select aria-label="采样对照" bind:value={filtering}
        ><option value="nearest">Nearest 像素</option><option value="linear">Linear 平滑</option></select
      ></label
    >
    <label
      >平铺 <select aria-label="平铺倍率" bind:value={repeat}
        ><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option></select
      ></label
    >
  </div>
  <small>仅改变检视效果，不修改游戏默认采样。</small>
{/if}

<style>
  .preview-toolbar,
  .action-strip {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 12px;
  }
  .preview-toolbar strong {
    margin-right: auto;
    font-size: 13px;
  }
  .viewport {
    position: relative;
    height: 360px;
    background: #0f1517;
    border: 1px solid #34403b;
    border-radius: 10px;
    overflow: hidden;
  }
  canvas {
    width: 100% !important;
    height: 100% !important;
    display: block;
    touch-action: none;
  }
  .view-label {
    position: absolute;
    bottom: 14px;
    left: 16px;
    color: #a1b2ae;
    font-size: 11px;
    pointer-events: none;
  }
  .preview-error {
    position: absolute;
    inset: 20%;
    color: #ffb5a3;
  }
  .action-strip {
    margin-top: 12px;
  }
  small {
    color: #96aaa0;
    font-size: 11px;
  }
</style>

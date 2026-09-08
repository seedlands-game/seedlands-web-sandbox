<script lang="ts">
  import type { Asset, PixelModel, PixelTexture, Rgb } from '../../client/presentation/asset-types';
  import {
    appearanceAnimationTargets,
    modelAnimationRoles,
    type AppearanceAnimationBinding,
    type AppearanceAnimationTarget,
    type ModelAnimationRole,
  } from '../../client/presentation/appearance-project';
  import type { GlbModelStats, StoredGlb } from '../../client/presentation/glb-model';
  import { publicAssetUrl } from '../../client/presentation/public-asset-url';
  import AppearanceCenterAtlasExport from './appearance-center-atlas-export.svelte';
  import ModelImport from './model-import.svelte';
  import ModelProperties from './model-properties.svelte';
  import PixelEditor from './pixel-editor.svelte';

  let {
    asset,
    texture,
    assets,
    users,
    revision,
    saving,
    onselect,
    onpaint,
    onbegin,
    onmodeledit,
    oncopy,
    ondelete,
    onpalette,
    onresize,
    onreplaceimage,
    onreimport,
    onexportglb,
    ondeleteglb,
    glbStats,
    animationBindings,
    previewAnimationClip,
    onpreviewanimation,
    onbindanimation,
    onclearanimation,
    onexport,
    onimport,
    onlegacyimport,
    onrestore,
    onerror,
  }: {
    asset?: Asset;
    texture?: PixelTexture;
    assets: Asset[];
    users: Asset[];
    revision: number;
    saving: boolean;
    onselect: (asset: Asset) => void;
    onpaint: (texture: PixelTexture, x: number, y: number, color: number) => void;
    onbegin: () => void;
    onmodeledit: (change: (model: PixelModel) => void) => void;
    oncopy: () => void;
    ondelete: () => void;
    onpalette: (texture: PixelTexture, index: number, value: string) => void;
    onresize: (texture: PixelTexture, size: number) => void;
    onreplaceimage: (file: File) => Promise<void>;
    onreimport: (file: File) => Promise<void>;
    onexportglb: () => Promise<void>;
    ondeleteglb: () => Promise<void>;
    glbStats?: GlbModelStats;
    animationBindings: Partial<Record<AppearanceAnimationTarget, AppearanceAnimationBinding>>;
    previewAnimationClip: string;
    onpreviewanimation: (clip: string) => void;
    onbindanimation: (target: AppearanceAnimationTarget, role: ModelAnimationRole, clip: string) => void;
    onclearanimation: (target: AppearanceAnimationTarget, role: ModelAnimationRole) => void;
    onexport: () => Promise<void>;
    onimport: (file: File) => Promise<void>;
    onlegacyimport: (model: StoredGlb) => Promise<void>;
    onrestore: (mode: 'default' | 'previous') => Promise<void>;
    onerror: (message: string) => void;
  } = $props();

  let color = $state(1);
  let packageInput = $state<HTMLInputElement>(undefined!);
  let imageInput = $state<HTMLInputElement>(undefined!);
  let reimportInput = $state<HTMLInputElement>(undefined!);
  let animationTarget = $state<AppearanceAnimationTarget>('settler');
  const hex = (rgb: Rgb) => `#${rgb.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
  const isNative = (value: Asset | undefined): value is PixelTexture | PixelModel =>
    value?.type === 'pixel-texture' || value?.type === 'extruded-pixel-model';
  async function selected(input: HTMLInputElement, action: (file: File) => Promise<void>) {
    const file = input.files?.[0];
    input.value = '';
    if (file) await action(file);
  }
  const boundClip = (role: ModelAnimationRole): string => {
    if (asset?.type !== 'glb-model') return '';
    const binding = animationBindings[animationTarget];
    return binding?.modelId === asset.payload.modelId ? (binding.clips[role] ?? '') : '';
  };
</script>

<aside class="inspector">
  <div class="heading">
    <div>
      <span>编辑源</span>
      <h2>{asset?.name ?? '选择资源'}</h2>
    </div>
    {#if asset}<small>r{asset.revision}</small>{/if}
  </div>
  {#if isNative(asset)}
    <div class="asset-actions">
      <button onclick={oncopy}>复制为独立源</button>{#if asset.source === 'user'}<button
          class="danger"
          onclick={ondelete}>删除草稿源</button
        >{/if}
    </div>
  {/if}
  {#if asset?.type === 'glb-model'}
    <p>GLB 模型保留稳定标识；重导入后会递增 revision。旧静态模型仍可直接预览。</p>
    {#if glbStats?.animationClips.length}
      <div class="animation-binding">
        <h3>骨骼动画</h3>
        <p>{glbStats.skinCount} 套 skin · {glbStats.animationClips.length} 个片段</p>
        <label
          >预览片段<select
            aria-label="预览动画片段"
            value={previewAnimationClip}
            onchange={(event) => onpreviewanimation(event.currentTarget.value)}
            >{#each glbStats.animationClips as clip (clip.name)}<option value={clip.name}
                >{clip.name} · {clip.durationSeconds.toFixed(2)}s</option
              >{/each}</select
          ></label
        >
        <label
          >应用对象<select bind:value={animationTarget} aria-label="动画应用对象"
            >{#each appearanceAnimationTargets as target (target)}<option value={target}>{target}</option
              >{/each}</select
          ></label
        >
        {#each modelAnimationRoles as role (role)}
          <label
            >{role}<select
              aria-label={`${role} 动画片段`}
              value={boundClip(role)}
              onchange={(event) => {
                const clip = event.currentTarget.value;
                if (clip) onbindanimation(animationTarget, role, clip);
                else onclearanimation(animationTarget, role);
              }}
              ><option value="">未绑定</option>{#each glbStats.animationClips as clip (clip.name)}<option
                  value={clip.name}>{clip.name}</option
                >{/each}</select
            ></label
          >
        {/each}
      </div>
    {:else if glbStats}
      <p>此模型没有动画片段，继续按旧静态 GLB 路径使用。</p>
    {/if}
    <div class="asset-actions">
      <button onclick={() => reimportInput.click()}>重导入 GLB</button><button onclick={onexportglb}
        >导出原始 GLB</button
      ><button class="danger" onclick={ondeleteglb}>删除模型</button>
    </div>
    <input
      bind:this={reimportInput}
      hidden
      type="file"
      accept=".glb,model/gltf-binary"
      aria-label="重导入静态 GLB"
      onchange={() => selected(reimportInput, onreimport)}
    />
  {:else if asset?.type === 'image-texture'}
    <img class="image-source" src={publicAssetUrl(import.meta.env.BASE_URL, asset.payload.path)} alt={asset.name} />
    <p>仅接受 PNG/JPEG data URL；单张图片上限 2 MiB。</p>
    <button onclick={() => imageInput.click()}>替换 PNG / JPEG</button><input
      bind:this={imageInput}
      hidden
      type="file"
      accept="image/png,image/jpeg"
      aria-label="替换美术图片"
      onchange={() => selected(imageInput, onreplaceimage)}
    />
  {:else if texture}
    <h3>像素源 · {texture.name}</h3>
    <PixelEditor {texture} {revision} {color} {onbegin} onpaint={(x, y) => onpaint(texture, x, y, color)} />
    <div class="palette">
      {#each texture.payload.palette as rgb, index (index)}<button
          class:selected={color === index}
          class:eraser={index === 0}
          style:background-color={index === 0 ? undefined : hex(rgb)}
          aria-label={index === 0 ? '透明色橡皮' : `颜色 ${index}`}
          onclick={() => (color = index)}>{index === 0 ? '×' : ''}</button
        >{/each}
    </div>
    {#if color > 0}<label class="color-picker"
        >编辑颜色 {color}<input
          aria-label={`编辑颜色 ${color}`}
          type="color"
          value={hex(texture.payload.palette[color])}
          onchange={(event) => onpalette(texture, color, event.currentTarget.value)}
        /></label
      >{/if}
    <div class="resize-actions">
      {#if texture.payload.width < 64}<button onclick={() => onresize(texture, texture.payload.width * 2)}
          >扩展至 {texture.payload.width * 2} × {texture.payload.width * 2}</button
        >{/if}
      {#if texture.payload.width > 16}<button onclick={() => onresize(texture, texture.payload.width / 2)}
          >缩小至 {texture.payload.width / 2} × {texture.payload.width / 2}</button
        >{/if}
    </div>
  {/if}
  {#if asset?.type === 'extruded-pixel-model'}<ModelProperties
      model={asset}
      all={assets}
      {texture}
      readonly={false}
      onedit={onmodeledit}
    />{/if}
  <section class="dependencies">
    <h3>依赖与用途</h3>
    {#if asset}{#each users as user (user.id)}<button onclick={() => onselect(user)}>{user.name} →</button>{:else}<p>
          没有额外引用。
        </p>{/each}{/if}
  </section>
  <section class="project-actions">
    <h3>项目包</h3>
    <button onclick={onexport}>导出完整项目</button><button onclick={() => packageInput.click()}>导入完整项目</button
    ><input
      bind:this={packageInput}
      hidden
      type="file"
      accept="application/json,.json"
      aria-label="导入完整项目"
      onchange={() => selected(packageInput, onimport)}
    /><ModelImport onimport={onlegacyimport} {onerror} /><button disabled={saving} onclick={() => onrestore('previous')}
      >恢复上一个应用版本</button
    ><button class="danger" disabled={saving} onclick={() => onrestore('default')}>恢复默认外观</button>
    <p>恢复上一版会同时还原草稿与模型库。</p>
  </section>
  <AppearanceCenterAtlasExport
    textures={assets.filter((candidate): candidate is PixelTexture => candidate.type === 'pixel-texture')}
  />
</aside>

<style>
  .inspector {
    min-width: 0;
    padding: 22px;
    border-left: 1px solid #334438;
    background: #152019;
    overflow: auto;
  }
  .heading {
    display: flex;
    align-items: start;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 14px;
  }
  .heading span,
  .heading small,
  p {
    color: #9daf9f;
    font-size: 11px;
  }
  .heading h2 {
    margin: 2px 0 0;
    font-size: 17px;
  }
  .asset-actions,
  .resize-actions {
    display: flex;
    gap: 7px;
    flex-wrap: wrap;
    margin: 0 0 12px;
  }
  .inspector h3 {
    font-size: 13px;
    margin: 18px 0 9px;
  }
  .image-source {
    width: 100%;
    max-height: 230px;
    object-fit: contain;
    background: #0d1511;
    image-rendering: pixelated;
    border-radius: 8px;
  }
  .palette {
    display: flex;
    gap: 5px;
    flex-wrap: wrap;
    margin: 9px 0;
  }
  .palette button {
    width: 26px;
    height: 26px;
    padding: 0;
    border-radius: 50%;
  }
  .palette button.selected {
    outline: 2px solid #dec379;
    outline-offset: 2px;
  }
  .palette button.eraser {
    background: #25322b;
  }
  .color-picker {
    display: flex;
    align-items: center;
    justify-content: space-between;
    color: #b8c4b7;
    font-size: 11px;
  }
  .animation-binding label {
    display: grid;
    grid-template-columns: 78px minmax(0, 1fr);
    align-items: center;
    gap: 8px;
    margin: 7px 0;
    color: #b8c4b7;
    font-size: 11px;
  }
  .color-picker input {
    width: 40px;
    height: 28px;
    padding: 2px;
  }
  .dependencies,
  .project-actions {
    border-top: 1px solid #3c4a40;
    margin-top: 18px;
    padding-top: 4px;
  }
  .dependencies button,
  .project-actions > button {
    display: block;
    width: 100%;
    text-align: left;
    margin: 6px 0;
  }
  .danger {
    color: #efa890;
    background: transparent;
  }
  @media (max-width: 1050px) {
    .inspector {
      grid-column: 2;
      border-left: 0;
      border-top: 1px solid #334438;
    }
  }
  @media (max-width: 720px) {
    .inspector {
      padding: 16px;
      border-left: 0;
      border-top: 1px solid #334438;
    }
  }
</style>

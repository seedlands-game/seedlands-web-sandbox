<script lang="ts">
  import { onMount } from 'svelte';
  import type { NativeAsset, PixelTexture, PixelModel, Rgb } from '../../client/presentation/asset-types';
  import { builtinItemBindings } from '../../client/presentation/asset-catalog';
  import { assetAdapter, assetDependencies, isNativeAsset } from '../../client/presentation/asset-adapters';
  import { parseAssetPackage } from '../../client/presentation/asset-package';
  import { publicAssetUrl } from '../../client/presentation/public-asset-url';
  import { loadAssetLibrary, saveAssetLibrary } from '../../client/persistence/asset-workbench-store';
  import { EditorState } from './editor-state';
  import AssetThumbnail from './asset-thumbnail.svelte';
  import AssetPreview from './asset-preview.svelte';
  import PixelEditor from './pixel-editor.svelte';
  import NewAssetDialog from './new-asset-dialog.svelte';
  import WorkbenchStatus from './workbench-status.svelte';
  import './workbench.css';

  const editor = new EditorState();
  let revision = $state(0);
  let libraryRevision = 0;
  let loaded = $state(false);
  let saving = $state(false);
  let search = $state('');
  let tab = $state<'items' | 'assets'>('items');
  let filter = $state('all');
  let mobilePanel = $state<'library' | 'edit' | 'preview'>('edit');
  let status = $state('正在打开本地资产库…');
  let failure = $state(false);
  let color = $state(2);
  let imageFailure = $state(false);
  let imageSize = $state('');
  let showNew = $state(false);
  let importInput: HTMLInputElement;

  const all = $derived.by(() => {
    revision;
    return editor.all;
  });
  const selected = $derived.by(() => {
    revision;
    return editor.selected;
  });
  const canUndo = $derived.by(() => {
    revision;
    return editor.canUndo;
  });
  const canRedo = $derived.by(() => {
    revision;
    return editor.canRedo;
  });
  const dirty = $derived.by(() => {
    revision;
    return editor.dirty;
  });
  const texture = $derived.by((): PixelTexture | undefined => {
    if (selected?.type === 'pixel-texture') return selected;
    if (selected?.type === 'extruded-pixel-model')
      return all.find((a) => a.id === selected.payload.textureId && a.type === 'pixel-texture') as
        PixelTexture | undefined;
  });
  const readonly = $derived(selected?.source !== 'user');
  const users = $derived(
    selected
      ? builtinItemBindings.filter((b) => b.iconId === selected.id || b.modelId === selected.id).map((b) => b.name)
      : [],
  );
  const references = $derived(selected ? all.filter((a) => assetDependencies(a).includes(selected.id)) : []);
  const listed = $derived(
    all.filter(
      (a) =>
        (filter === 'all' || a.type === filter || (filter === 'user' && a.source === 'user')) &&
        `${a.name} ${a.id}`.toLowerCase().includes(search.toLowerCase()),
    ),
  );

  function refresh() {
    revision++;
  }
  function message(text: string, error = false) {
    status = text;
    failure = error;
  }
  function run(action: () => void) {
    try {
      action();
      refresh();
    } catch (error) {
      message(error instanceof Error ? error.message : String(error), true);
    }
  }
  function select(id: string) {
    if (id !== editor.selectedId && editor.dirty && !confirm('有未保存修改。切换后仍保留在本页，确定切换？')) return;
    editor.selectedId = id;
    imageFailure = false;
    imageSize = '';
    refresh();
    mobilePanel = 'edit';
  }
  async function reloadLibrary() {
    if (editor.dirty && !confirm('重新加载会丢弃本页未保存修改。建议先导出备份，仍要继续？')) return;
    try {
      const library = await loadAssetLibrary();
      libraryRevision = library.revision;
      editor.load(library.assets);
      refresh();
      message('本地资产库已就绪');
    } catch (error) {
      message(`本地保存不可用：${error instanceof Error ? error.message : String(error)}。仍可编辑并导出。`, true);
    } finally {
      loaded = true;
    }
  }
  onMount(() => {
    void reloadLibrary();
    const guard = (event: BeforeUnloadEvent) => {
      if (editor.dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  });
  async function save() {
    saving = true;
    try {
      const result = await saveAssetLibrary(structuredClone(editor.assets), libraryRevision);
      libraryRevision = result.revision;
      editor.markSaved(result.assets);
      refresh();
      message('已保存到此浏览器');
    } catch (error) {
      message(`保存失败：${error instanceof Error ? error.message : String(error)}`, true);
    } finally {
      saving = false;
    }
  }
  async function saveAsCopy() {
    try {
      const latest = await loadAssetLibrary();
      editor.rebaseAsCopy(latest.assets);
      libraryRevision = latest.revision;
      refresh();
      message('草稿已作为新副本保留，请保存');
    } catch (error) {
      message(String(error), true);
    }
  }
  function touch(asset: NativeAsset) {
    asset.revision++;
    editor.changed();
    refresh();
  }
  function paint(x: number, y: number) {
    if (!texture || readonly) return;
    const index = y * texture.payload.width + x;
    const next = Math.min(color, texture.payload.palette.length - 1);
    if (texture.payload.pixels[index] === next) return;
    texture.payload.pixels[index] = next;
    touch(texture);
  }
  function editModel(change: (model: PixelModel) => void) {
    if (selected?.type !== 'extruded-pixel-model' || readonly) return;
    editor.checkpoint();
    change(selected);
    touch(selected);
  }
  $effect(() => {
    if (texture && color >= texture.payload.palette.length) color = texture.payload.palette.length - 1;
  });
  function editColor(hex: string) {
    if (!texture || readonly || color === 0) return;
    editor.checkpoint();
    texture.payload.palette[color] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
    touch(texture);
  }
  const hexColor = (rgb: Rgb) => `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  function download(text: string, name: string) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importFile() {
    const file = importInput.files?.[0];
    if (!file) return;
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('资产包超过2 MiB');
      const assets = parseAssetPackage(await file.text());
      editor.import(assets);
      tab = 'assets';
      refresh();
      message(`导入 ${assets.length} 项资产为新副本，请保存`);
    } catch (error) {
      message(`导入失败：${error instanceof Error ? error.message : String(error)}`, true);
    }
    importInput.value = '';
  }
</script>

<svelte:head
  ><title>资产工坊 · Seedlands</title><meta
    name="description"
    content="在一个地方查看、编辑和预览 Seedlands 资产。"
  /></svelte:head
>
<div class="workbench">
  <header class="app-header">
    <a class="brand" href={import.meta.env.BASE_URL}
      ><span class="brand-mark">S</span><span>SEEDLANDS<small>ASSET WORKBENCH</small></span></a
    >
    <div class="workspace-title">资产工坊 <span class="beta">LOCAL</span></div>
    <div class="header-actions">
      <span class:unsaved={dirty} class="save-state"
        >{!loaded ? '正在加载…' : dirty ? '● 未保存修改' : '● 本地工作区'}</span
      >
      <button disabled={!loaded || saving} onclick={() => (showNew = true)}>＋ 新建资产</button>
      <button class="primary" disabled={!loaded || saving || !dirty} onclick={save}
        >{saving ? '正在保存…' : '保存修改'}</button
      >
    </div>
  </header>
  <nav class="mobile-tabs" aria-label="工坊面板">
    {#each [['library', '资产库'], ['edit', '编辑'], ['preview', '预览']] as [key, label] (key)}<button
        class:active={mobilePanel === key}
        onclick={() => (mobilePanel = key as typeof mobilePanel)}>{label}</button
      >{/each}
  </nav>
  <div class="workspace-grid">
    <aside class="library pane" class:mobile-visible={mobilePanel === 'library'}>
      <div class="section-heading">
        <h2>资产库</h2>
        <span>{all.length}</span>
      </div>
      <div class="segmented">
        <button class:active={tab === 'items'} onclick={() => (tab = 'items')}>按物品</button><button
          class:active={tab === 'assets'}
          onclick={() => (tab = 'assets')}>按资产</button
        >
      </div>
      <input class="search" aria-label="搜索资产" placeholder="搜索名称或标识…" bind:value={search} />
      {#if tab === 'assets'}<select aria-label="资产类型筛选" bind:value={filter}
          ><option value="all">所有类型</option><option value="user">我的草稿</option><option value="pixel-texture"
            >像素贴图</option
          ><option value="extruded-pixel-model">像素挤出模型</option><option value="image-texture">图片贴图</option
          ><option value="builtin-item-model">内置模型</option></select
        >{/if}
      <div class="asset-list">
        {#if tab === 'items'}
          {#each builtinItemBindings.filter( (b) => `${b.name} ${b.itemId}`.includes(search) ) as binding (binding.itemId)}
            {@const model = all.find((a) => a.id === binding.modelId)!}
            <button
              class="asset-row"
              class:selected={selected?.id === binding.modelId || selected?.id === binding.iconId}
              onclick={() => select(binding.modelId)}
            >
              <AssetThumbnail asset={model} assets={all} {revision} /><span
                ><strong>{binding.name}</strong><small>{assetAdapter(model.type).label}</small></span
              >
            </button>
            {#if selected?.id === binding.modelId || selected?.id === binding.iconId}<div class="item-links">
                <button onclick={() => select(binding.modelId)}>模型</button><button
                  onclick={() => select(binding.iconId)}>图标 / 贴图</button
                >
              </div>{/if}
          {/each}
        {:else}
          {#each listed as asset (asset.id)}<button
              class="asset-row"
              class:selected={selected?.id === asset.id}
              onclick={() => select(asset.id)}
              ><AssetThumbnail {asset} assets={all} {revision} /><span
                ><strong>{asset.name}</strong><small
                  >{asset.source === 'user' ? '草稿 · ' : ''}{assetAdapter(asset.type).label}</small
                ></span
              ></button
            >{/each}
          {#if !listed.length}<p class="empty">没有匹配的资产</p>{/if}
        {/if}
      </div>
      <div class="library-footer">
        <button disabled={!loaded} onclick={() => importInput.click()}>导入资产包</button><button
          onclick={reloadLibrary}>重新加载</button
        ><input
          bind:this={importInput}
          type="file"
          accept=".json,application/json"
          hidden
          onchange={importFile}
        /><small>源资产保存在此浏览器<br />导出文件可用作备份</small>
      </div>
    </aside>
    {#if selected}
      <main class="editor-pane pane" class:mobile-visible={mobilePanel === 'edit'}>
        <div class="eyebrow">{selected.source === 'builtin' ? 'FIRST-PARTY / 内置资产' : 'MY LIBRARY / 本地草稿'}</div>
        <div class="title-row">
          <h1>{selected.name}</h1>
          <span class="type-tag">{assetAdapter(selected.type).label}</span>
        </div>
        <div class="editor-actions">
          {#if isNativeAsset(selected)}<button
              disabled={!loaded || saving}
              onclick={() =>
                run(() => {
                  editor.copy();
                  tab = 'assets';
                  message('已创建独立副本，可开始编辑');
                })}>复制为草稿</button
            ><button onclick={() => run(() => download(editor.exportSelected(), 'seedlands-asset.json'))}
              >导出资产包</button
            >{/if}
          {#if !readonly}<button disabled={!canUndo} onclick={() => run(() => editor.undo())}>撤销</button><button
              disabled={!canRedo}
              onclick={() => run(() => editor.redo())}>重做</button
            ><button
              class="danger"
              onclick={() => {
                if (confirm('删除这个本地资产？共享依赖会保留。')) run(() => editor.deleteSelected());
              }}>删除</button
            >{/if}
        </div>
        {#if readonly}<div class="notice">
            {isNativeAsset(selected)
              ? '内置资产只读。复制为草稿，即可绘制和调整模型。'
              : '此类型目前支持查看与预览，内容编辑将由对应资产适配器提供。'}
          </div>{/if}
        {#if texture}
          <div class="editor-label">
            <h2>像素源</h2>
            <span>{texture.name}</span>
          </div>
          <PixelEditor {texture} {readonly} {color} {revision} onbegin={() => editor.checkpoint()} onpaint={paint} />
          <div class="palette" aria-label="调色板">
            {#each texture.payload.palette as rgb, index (index)}<button
                class:chosen={color === index}
                class:transparent={index === 0}
                style:background-color={index === 0 ? undefined : hexColor(rgb)}
                aria-label={index === 0 ? '橡皮' : `颜色 ${index}`}
                aria-pressed={color === index}
                onclick={() => (color = index)}>{index === 0 ? '×' : ''}</button
              >{/each}
            {#if !readonly && texture.payload.palette.length < 32}<button
                aria-label="添加颜色"
                onclick={() => {
                  if (!texture) return;
                  editor.checkpoint();
                  texture.payload.palette.push([180, 180, 180]);
                  color = texture.payload.palette.length - 1;
                  touch(texture);
                }}>＋</button
              >{/if}
          </div>
          {#if !readonly && color > 0}<label class="color-control"
              >编辑颜色 <input
                aria-label="编辑颜色"
                type="color"
                value={hexColor(texture.payload.palette[Math.min(color, texture.payload.palette.length - 1)])}
                onchange={(event) => editColor(event.currentTarget.value)}
              /></label
            >{/if}
          <p class="hint">
            {readonly ? '同一像素源派生图标和模型。' : '拖动画笔连续绘制；也可聚焦画布后用方向键定位、空格绘制。'}
          </p>
        {:else if selected.type === 'image-texture'}
          <div class="image-stage">
            <img
              src={publicAssetUrl(import.meta.env.BASE_URL, selected.payload.path)}
              alt={selected.name}
              onload={(event) => {
                if (event.currentTarget instanceof HTMLImageElement)
                  imageSize = `${event.currentTarget.naturalWidth} × ${event.currentTarget.naturalHeight}`;
                imageFailure = false;
              }}
              onerror={() => (imageFailure = true)}
            />
          </div>
          {#if imageFailure}<p role="alert">缺失资源：{selected.payload.path}</p>{:else}<p class="hint">
              {imageSize} · 原始 PNG · 透明背景
            </p>{/if}
        {:else}
          <div class="model-description">
            <AssetThumbnail asset={selected} assets={all} {revision} />
            <h2>游戏中的原始模型</h2>
            <p>右侧使用游戏现有代码展示这件物品。它保留自己的生产方式，不经过像素挤出编辑器。</p>
            <span class="type-tag">只读预览</span>
          </div>
        {/if}
        <div class="metadata">
          <label
            >资产名称 <input
              aria-label="资产名称"
              value={selected.name}
              disabled={readonly}
              maxlength="120"
              onchange={(event) =>
                run(() => {
                  if (!selected || !isNativeAsset(selected) || !event.currentTarget.value.trim())
                    throw new Error('名称不能为空');
                  editor.checkpoint();
                  selected.name = event.currentTarget.value.trim();
                  touch(selected);
                })}
            /></label
          >
          <div><span>标识</span><code>{selected.id}</code></div>
          <div>
            <span>来源</span><strong>{readonly ? '项目内置 / 只读' : '本地可编辑源'} · r{selected.revision}</strong>
          </div>
          {#if selected.type === 'extruded-pixel-model'}
            <label
              >关联贴图 <select
                aria-label="关联贴图"
                disabled={readonly}
                value={selected.payload.textureId}
                onchange={(event) =>
                  editModel((model) => {
                    const next = all.find((a) => a.id === event.currentTarget.value) as PixelTexture;
                    model.payload.textureId = next.id;
                    model.payload.grip = [
                      Math.min(model.payload.grip[0], next.payload.width),
                      Math.min(model.payload.grip[1], next.payload.height),
                    ];
                  })}
                >{#each all.filter((a) => a.type === 'pixel-texture' && (readonly || a.source === 'user')) as t (t.id)}<option
                    value={t.id}>{t.name}</option
                  >{/each}</select
              ></label
            >
            <label
              >总厚度（像素）<input
                aria-label="模型厚度"
                type="range"
                min="1"
                max="8"
                step="1"
                disabled={readonly}
                value={selected.payload.thicknessPixels}
                oninput={(event) =>
                  editModel((model) => (model.payload.thicknessPixels = Number(event.currentTarget.value)))}
              /><output>{selected.payload.thicknessPixels}</output></label
            >
            {#each ['X', 'Y'] as axis, i (axis)}<label
                >握持点 {axis}<input
                  aria-label={`握持点 ${axis}`}
                  type="number"
                  min="0"
                  max={texture?.payload.width ?? 64}
                  step="0.5"
                  disabled={readonly}
                  value={selected.payload.grip[i]}
                  onchange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value))
                      editModel(
                        (model) => (model.payload.grip[i] = Math.max(0, Math.min(texture?.payload.width ?? 64, value))),
                      );
                  }}
                /></label
              >{/each}
          {/if}
        </div>
      </main>
      <aside class="preview-pane pane" class:mobile-visible={mobilePanel === 'preview'}>
        <AssetPreview asset={selected} assets={all} {revision} />
        <section class="usage">
          <h2>引用与用途</h2>
          {#if users.length}{#each users as name (name)}<p>
                <span class="usage-dot"></span>{name}<small>内置物品展示</small>
              </p>{/each}{/if}{#each references as ref (ref.id)}<button onclick={() => select(ref.id)}
              >{ref.name} → 使用此贴图</button
            >{/each}{#if !users.length && !references.length}<p class="muted">
              暂无游戏绑定。草稿不会自动覆盖游戏资产。
            </p>{/if}
        </section>
        <section class="pipeline-note">
          <span>同源表现</span>
          <p>编辑的是源数据。模型、图标和预览由它派生，游戏与工坊共用生成代码。</p>
        </section>
      </aside>
    {/if}
  </div>
  <WorkbenchStatus
    {status}
    {failure}
    {dirty}
    count={all.length}
    oncopy={saveAsCopy}
    onexport={() =>
      download(JSON.stringify({ schemaVersion: 1, assets: editor.assets }, null, 2), 'seedlands-backup.json')}
  />
</div>
{#if showNew}
  <NewAssetDialog
    onclose={() => (showNew = false)}
    oncreate={(size, model) =>
      run(() => {
        editor.create(size, model);
        tab = 'assets';
        showNew = false;
        message('新资产已创建，请编辑后保存');
      })}
  />
{/if}

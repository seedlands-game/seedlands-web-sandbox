<script lang="ts">
  import { onMount } from 'svelte';
  import type { Asset, NativeAsset, PixelTexture, PixelModel, Rgb } from '../../client/presentation/asset-types';
  import { builtinItemBindings } from '../../client/presentation/asset-catalog';
  import { assetAdapter, assetDependencies, isNativeAsset } from '../../client/presentation/asset-adapters';
  import { parseAssetPackage } from '../../client/presentation/asset-package';
  import { publicAssetUrl } from '../../client/presentation/public-asset-url';
  import { loadAssetLibrary, saveAssetLibrary } from '../../client/persistence/asset-workbench-store';
  import { EditorState } from './editor-state';
  import AssetPreview from './asset-preview.svelte';
  import PixelEditor from './pixel-editor.svelte';
  import NewAssetDialog from './new-asset-dialog.svelte';
  import WorkbenchStatus from './workbench-status.svelte';
  import './workbench.css';
  import AssetLibrary from './asset-library.svelte';
  import AssetDetails from './asset-details.svelte';
  import ModelProperties from './model-properties.svelte';
  import TexturePackPanel from './texture-pack-panel.svelte';
  import type { StoredGlb } from '../../client/presentation/glb-model';
  import { listGlbModels } from '../../client/persistence/glb-model-store';

  const editor = new EditorState();
  let revision = $state(0);
  let libraryRevision = 0;
  let loaded = $state(false);
  let saving = $state(false);
  let tab = $state<'usage' | 'items' | 'assets'>('usage');
  let models = $state<StoredGlb[]>([]);
  let mobilePanel = $state<'library' | 'edit' | 'preview'>('edit');
  let status = $state('正在打开本地资产库…');
  let failure = $state(false);
  let color = $state(2);
  let imageFailure = $state(false);
  let imageSize = $state('');
  let showNew = $state(false);
  let viewportWidth = $state(1280);
  let importInput: HTMLInputElement;

  const all = $derived.by(() => {
    revision;
    return [
      ...editor.all,
      ...models.map((model): Asset => ({
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
      })),
    ];
  });
  const selected = $derived.by(() => {
    revision;
    return all.find((asset) => asset.id === editor.selectedId);
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
    if (selected?.type === 'extruded-pixel-model' || selected?.type === 'material')
      return all.find((a) => a.id === selected.payload.textureId && a.type === 'pixel-texture') as
        PixelTexture | undefined;
  });
  const readonly = $derived(!selected || selected.source !== 'user' || !isNativeAsset(selected));
  const users = $derived(
    selected
      ? builtinItemBindings.filter((b) => b.iconId === selected.id || b.modelId === selected.id).map((b) => b.name)
      : [],
  );
  const references = $derived(selected ? all.filter((a) => assetDependencies(a).includes(selected.id)) : []);

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
      try {
        models = await listGlbModels();
      } catch (error) {
        message(`模型库读取失败：${String(error)}`, true);
      }
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

<svelte:window bind:innerWidth={viewportWidth} />
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
    <AssetLibrary
      assets={all}
      selectedId={editor.selectedId}
      {revision}
      {loaded}
      mobileVisible={mobilePanel === 'library'}
      bind:tab
      onselect={select}
      onreload={reloadLibrary}
      onimport={() => importInput.click()}
      onmodel={(model) => {
        models = [...models, model];
        select(model.id);
        tab = 'usage';
        message('模型已导入并保存到本地');
      }}
      onerror={(error) => message(error, true)}
    />
    <input bind:this={importInput} type="file" accept=".json,application/json" hidden onchange={importFile} />
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
          {#if viewportWidth > 850}<div class="model-stage">
              <AssetPreview asset={selected} assets={all} {revision} />
            </div>{:else}<p class="hint">切换「预览」面板可旋转查看此模型。</p>{/if}
        {/if}
        {#if texture || selected.type === 'image-texture'}<AssetDetails
            asset={selected}
            assets={all}
            onselect={select}
            onerror={(error) => message(error, true)}
            ondeleted={(id) => {
              models = models.filter((model) => model.id !== id);
              select('builtin:model:stone-pickaxe');
              message('模型已删除');
            }}
          />
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
            <span>来源</span><strong
              >{selected.source === 'builtin'
                ? '项目内置 / 只读'
                : selected.type === 'glb-model'
                  ? '本地 GLB / 已保存'
                  : '本地可编辑源'} · r{selected.revision}</strong
            >
          </div>
          {#if selected.type === 'extruded-pixel-model'}<ModelProperties
              model={selected}
              {all}
              {texture}
              {readonly}
              onedit={editModel}
            />{/if}
        </div>
      </main>
      <aside class="preview-pane pane" class:mobile-visible={mobilePanel === 'preview'}>
        {#if texture || selected.type === 'image-texture' || viewportWidth <= 850}<AssetPreview
            asset={selected}
            assets={all}
            {revision}
          />
        {:else}<h2>资产信息</h2>
          <AssetDetails
            asset={selected}
            assets={all}
            onselect={select}
            onerror={(error) => message(error, true)}
            ondeleted={(id) => {
              models = models.filter((model) => model.id !== id);
              select('builtin:model:stone-pickaxe');
              message('模型已删除');
            }}
          />{/if}
        {#if texture || selected.type === 'builtin-voxel-model'}<TexturePackPanel
            {texture}
            textures={all.filter((a): a is PixelTexture => a.type === 'pixel-texture')}
            onapplied={refresh}
          />{/if}
        <section class="usage">
          <h2>引用与用途</h2>
          {#if users.length}{#each users as name (name)}<p>
                <span class="usage-dot"></span>{name}<small>内置物品展示</small>
              </p>{/each}{/if}{#each references as ref (ref.id)}<button onclick={() => select(ref.id)}
              >{ref.name} → 使用此贴图</button
            >{/each}{#if !users.length && !references.length}<p class="muted">
              {selected.source === 'builtin'
                ? selected.type === 'builtin-actor-model' && selected.payload.kind === 'player'
                  ? '玩家比例基准；第一人称手臂使用相同定义。'
                  : '项目内置资产，由对应游戏表现适配器使用。'
                : '暂无游戏绑定。草稿和导入模型不会自动覆盖游戏资产。'}
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

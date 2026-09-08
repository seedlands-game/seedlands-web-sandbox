<script lang="ts">
  import { onMount } from 'svelte';
  import type {
    Asset,
    MaterialAsset,
    NativeAsset,
    PixelModel,
    PixelTexture,
  } from '../../client/presentation/asset-types';
  import { getItemDefinition } from '@seedlands/game-core/server/gameplay/item-registry';
  import {
    appearanceObjects,
    materialSlots,
    type AppearanceContext,
  } from '../../client/presentation/appearance-catalog';
  import { resolveAppearanceAssets } from '../../client/presentation/appearance-project';
  import type { StoredGlb } from '../../client/presentation/glb-model';
  import {
    decodeAppearancePackage,
    encodeAppearancePackage,
    loadAppearanceModelBlobs,
    loadAppearanceProject,
    restoreAppearanceProject,
    saveAppearanceProject,
  } from '../../client/persistence/appearance-project-store';
  import { loadAssetLibrary } from '../../client/persistence/asset-workbench-store';
  import { listGlbModels } from '../../client/persistence/glb-model-store';
  import { renderAppearanceThumbnails } from './appearance-thumbnails';
  import { AppearanceEditor } from './appearance-editor';
  import { collectAppearanceModels, readAppearanceImage } from './appearance-center-io';
  import { createAppearanceGlbActions } from './appearance-center-glb-actions';
  import {
    copyAndInsertNativeAssets,
    createAndInsertNativeAssets,
    deleteSelectedNativeAsset,
    editAppearanceMaterial,
    editFocusedPixelModel,
    makeAppearanceMaterialPrivate,
    paintAppearancePixel,
    replaceAppearanceImage,
    replacePaletteColor,
    resizeAppearanceTexture,
  } from './appearance-center-native-assets';
  import AppearanceCenterNavigation from './appearance-center-navigation.svelte';
  import AppearanceMaterialEditor from './appearance-material-editor.svelte';
  import AssetPreview from './asset-preview.svelte';
  import AppearanceCenterInspector from './appearance-center-inspector.svelte';
  import NewAssetDialog from './new-asset-dialog.svelte';
  import './appearance-center.css';
  import './workbench.css';

  const editor = new AppearanceEditor();
  let revision = $state(0);
  let projectRevision = 0;
  let loaded = $state(false);
  let saving = $state(false);
  let status = $state('正在打开外观项目…');
  let failed = $state(false);
  let objectId = $state('builtin:model:lantern');
  let context = $state<AppearanceContext | undefined>();
  let resourceId = $state('builtin:model:lantern');
  let resourceCategory = $state<'model' | 'material' | 'image'>('model');
  let allModels = $state<StoredGlb[]>([]);
  let projectModelIds = $state<string[]>([]);
  let showNew = $state(false);

  const modelAssets = $derived.by(() =>
    allModels.map((model): Asset => ({
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
  );
  const resolved = $derived.by(() => {
    revision;
    return resolveAppearanceAssets(editor.project, context?.assetId);
  });
  const all = $derived([...resolved, ...modelAssets]);
  const objects = $derived(appearanceObjects(all));
  const selectedObject = $derived(objects.find((entry) => entry.id === objectId));
  const selectedContext = $derived(
    selectedObject?.contexts.find((entry) => entry.name === context?.name && entry.assetId === context?.assetId) ??
      selectedObject?.contexts[0],
  );
  const previewAsset = $derived(
    all.find((asset) => asset.id === selectedContext?.assetId) ?? all.find((asset) => asset.id === resourceId),
  );
  const focusAsset = $derived(all.find((asset) => asset.id === resourceId) ?? previewAsset);
  const slots = $derived(previewAsset ? materialSlots(previewAsset, all) : []);
  const focusedMaterial = $derived.by(() => {
    if (focusAsset?.type !== 'material' || !previewAsset) return undefined;
    return editor.materialSource(previewAsset.id, focusAsset);
  });
  const focusTexture = $derived.by((): PixelTexture | undefined => {
    if (focusAsset?.type === 'pixel-texture') return focusAsset;
    const material = focusedMaterial ?? (focusAsset?.type === 'material' ? focusAsset : undefined);
    if (!material) return undefined;
    return all.find(
      (asset): asset is PixelTexture => asset.id === material.payload.textureId && asset.type === 'pixel-texture',
    );
  });
  const canPrivateMaterials = $derived.by(() => {
    if (!previewAsset || previewAsset.id === 'builtin:model:lantern') return false;
    if (previewAsset.type === 'builtin-actor-model' || previewAsset.type === 'builtin-arm-model') return true;
    return (
      previewAsset.type === 'builtin-item-model' &&
      getItemDefinition(previewAsset.payload.itemId).placesVoxel === undefined
    );
  });
  const sharedMaterialNote = $derived(
    previewAsset?.id === 'builtin:model:lantern'
      ? '灯笼材质在模型、放置、手持和掉落表现中共享，编辑会同步这四种上下文。'
      : '此方块材质与放置表现共享，编辑会同步全部引用。',
  );
  const previewAssets = $derived.by(() => {
    revision;
    return [...resolveAppearanceAssets(editor.project, selectedContext?.assetId), ...modelAssets];
  });
  const thumbnails = $derived.by(() => {
    revision;
    return editor.project.thumbnails;
  });
  const users = $derived.by(() => {
    revision;
    return focusAsset ? editor.users(focusAsset.id) : [];
  });

  const notify = (message: string, error = false) => ((status = message), (failed = error));
  const refresh = () => (revision += 1);
  const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));
  const download = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const anchor = Object.assign(document.createElement('a'), { href: url, download: name });
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  function selectObject(id: string) {
    const object = objects.find((entry) => entry.id === id);
    if (!object) return;
    [objectId, context, resourceId, resourceCategory] = [id, object.contexts[0], object.contexts[0].assetId, 'model'];
  }
  const selectContext = (next: AppearanceContext) =>
    ([context, resourceId, resourceCategory] = [next, next.assetId, 'model']);
  function selectResource(asset: Asset, preserveObject = false) {
    resourceId = asset.id;
    resourceCategory =
      asset.type === 'material'
        ? 'material'
        : asset.type === 'pixel-texture' || asset.type === 'image-texture'
          ? 'image'
          : 'model';
    if (resourceCategory !== 'model' && !preserveObject) {
      objectId = '';
      context = undefined;
    } else if (resourceCategory === 'model') {
      const object = objects.find((entry) => entry.id === asset.id);
      if (object) selectObject(object.id);
      else {
        objectId = '';
        context = undefined;
      }
    }
  }
  const selectLantern = () => {
    const lantern = objects.find((entry) => entry.id === 'builtin:model:lantern') ?? objects[0];
    if (lantern) selectObject(lantern.id);
  };
  const refreshModels = async () => {
    const [models, projectModels] = await Promise.all([listGlbModels(), loadAppearanceModelBlobs()]);
    allModels = models;
    projectModelIds = projectModels.map((model) => model.id);
  };
  const packageModels = () => collectAppearanceModels(allModels);
  async function loadProject() {
    try {
      const stored = await loadAppearanceProject();
      projectRevision = stored.revision;
      editor.load(stored.draft);
      if (stored.revision <= 1) {
        const legacy = await loadAssetLibrary();
        const missing = legacy.assets.filter(
          (asset) => !stored.draft.assets.some((current) => current.id === asset.id),
        );
        if (missing.length) {
          const saved = await saveAppearanceProject(
            { ...editor.project, assets: [...editor.project.assets, ...missing] },
            projectRevision,
            false,
          );
          projectRevision = saved.revision;
          editor.load(saved.draft);
          notify(`已把旧资产库的 ${missing.length} 项内容导入为草稿，尚未应用到游戏。`);
        }
      }
      await refreshModels();
      selectLantern();
      refresh();
      if (!status.includes('旧资产库')) notify('外观项目已就绪；保存草稿不会改变游戏。');
    } catch (error) {
      notify(`外观项目不可用：${errorMessage(error)}`, true);
    } finally {
      loaded = true;
    }
  }
  onMount(() => {
    void loadProject();
    const guard = (event: BeforeUnloadEvent) => {
      if (editor.dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  });

  async function saveDraft(apply = false) {
    if (saving) return;
    saving = true;
    try {
      if (apply) {
        editor.project.thumbnails = await renderAppearanceThumbnails(editor.project, undefined, modelAssets);
      }
      const saved = await saveAppearanceProject(editor.project, projectRevision, apply, await packageModels());
      projectRevision = saved.revision;
      editor.load(saved.draft);
      await refreshModels();
      refresh();
      notify(
        apply
          ? '已应用外观快照并生成 10 个物品高清缩略图；下次进入世界生效。'
          : '草稿已保存到此浏览器，游戏外观尚未改变。',
      );
    } catch (error) {
      notify(`${apply ? '应用' : '保存'}失败：${errorMessage(error)}`, true);
    } finally {
      saving = false;
    }
  }
  async function restore(mode: 'default' | 'previous') {
    if (saving) return;
    saving = true;
    try {
      const saved = await restoreAppearanceProject(projectRevision, mode);
      projectRevision = saved.revision;
      editor.load(saved.draft);
      refresh();
      notify(mode === 'default' ? '已恢复默认外观；下次进入世界生效。' : '已恢复上一个已应用外观；下次进入世界生效。');
    } catch (error) {
      notify(`恢复失败：${errorMessage(error)}`, true);
    } finally {
      saving = false;
    }
  }
  async function exportProject() {
    try {
      download(
        await encodeAppearancePackage(editor.project, await packageModels()),
        'seedlands-appearance-project.json',
      );
      notify('已导出完整外观项目包。');
    } catch (error) {
      notify(`导出失败：${errorMessage(error)}`, true);
    }
  }
  async function importProject(file: File) {
    try {
      const decoded = await decodeAppearancePackage(file);
      const saved = await saveAppearanceProject(decoded.project, projectRevision, false, decoded.models);
      projectRevision = saved.revision;
      editor.load(saved.draft);
      await refreshModels();
      selectLantern();
      refresh();
      notify('完整项目包已导入为草稿，尚未应用到游戏。');
    } catch (error) {
      notify(`导入失败，当前项目未改变：${errorMessage(error)}`, true);
    }
  }
  function editMaterial(slot: MaterialAsset, field: 'roughness' | 'metalness' | 'emissiveIntensity', value: number) {
    if (!previewAsset || !Number.isFinite(value)) return;
    resourceId = editAppearanceMaterial(editor, previewAsset.id, slot, field, value);
    refresh();
  }
  function privateMaterial(slot: MaterialAsset) {
    if (!previewAsset || !canPrivateMaterials) return;
    try {
      resourceId = makeAppearanceMaterialPrivate(editor, previewAsset.id, slot);
      refresh();
      notify('已创建仅此对象使用的材质和贴图副本。');
    } catch (error) {
      notify(errorMessage(error), true);
    }
  }
  const paint = (texture: PixelTexture, x: number, y: number, color: number) => {
    paintAppearancePixel(editor, texture, x, y, color);
    refresh();
  };
  function editPixelModel(change: (model: PixelModel) => void) {
    if (editFocusedPixelModel(editor, focusAsset, change)) refresh();
  }
  function selectNativeAssets(assets: readonly NativeAsset[]) {
    refresh();
    selectResource(assets.at(-1)!);
  }
  function createNative(size: number, model: boolean) {
    try {
      selectNativeAssets(createAndInsertNativeAssets(editor, all, size, model));
      showNew = false;
      notify(model ? '已创建像素挤出模型与独立贴图。' : '已创建独立像素贴图。');
    } catch (error) {
      notify(`新建失败：${errorMessage(error)}`, true);
    }
  }
  function copyNative() {
    try {
      const copies = copyAndInsertNativeAssets(editor, focusAsset, all);
      if (!copies) return;
      selectNativeAssets(copies);
      notify(`已复制 ${copies.length} 项原生资产，引用已改为新副本。`);
    } catch (error) {
      notify(`复制失败：${errorMessage(error)}`, true);
    }
  }
  function deleteNative() {
    const result = deleteSelectedNativeAsset(editor, focusAsset, all, (name) =>
      confirm(`删除“${name}”？此操作只影响当前草稿。`),
    );
    if (!result) return;
    if (result.references.length) {
      notify(`无法删除：仍被 ${result.references.join('、')} 引用。`, true);
      return;
    }
    if (!result.deleted) return;
    resourceId = selectedContext?.assetId ?? 'builtin:model:lantern';
    refresh();
    notify('已从当前草稿删除原生资产。');
  }
  function editPalette(texture: PixelTexture, index: number, value: string) {
    if (replacePaletteColor(editor, texture, index, value)) refresh();
  }
  function resizeTexture(texture: PixelTexture, size: number) {
    const previous = resizeAppearanceTexture(editor, texture, size);
    if (previous === null) return;
    refresh();
    notify(size > previous ? `已最近邻扩展至 ${size} × ${size}。` : `已缩小至 ${size} × ${size}。`);
  }
  async function replaceImage(file: File) {
    try {
      const dataUrl = await readAppearanceImage(file);
      if (!replaceAppearanceImage(editor, focusAsset, dataUrl)) return;
      refresh();
      notify(`已替换图片源：${file.name}（${(file.size / 1024).toFixed(0)} KiB）。`);
    } catch (error) {
      notify(`图片替换失败：${errorMessage(error)}`, true);
    }
  }
  const glbActions = createAppearanceGlbActions({
    asset: () => focusAsset,
    models: () => allModels,
    projectModelIds: () => projectModelIds,
    bumpProjectRevision: () => (projectRevision += 1),
    refreshModels,
    refresh,
    notify,
    message: errorMessage,
    download,
    clearSelection: () => (resourceId = selectedContext?.assetId ?? 'builtin:model:lantern'),
    confirmDelete: (name) => confirm(`删除模型“${name}”？此操作不可恢复。`),
  });
</script>

<svelte:head
  ><title>对象外观 · Seedlands</title><meta
    name="description"
    content="编辑 Seedlands 对象、材质与图像外观。"
  /></svelte:head
>

<div class="appearance-center">
  <header>
    <a href={import.meta.env.BASE_URL} class="brand"><span>S</span> SEEDLANDS <small>OBJECT APPEARANCE</small></a>
    <div><strong>对象外观</strong><small>草稿、应用和恢复彼此独立</small></div>
    <div class="actions">
      <span class:dirty={editor.dirty}>{editor.dirty ? '有未保存草稿' : '草稿已保存'}</span>
      <button
        disabled={!loaded || saving || !editor.canUndo}
        onclick={() => {
          editor.undo();
          refresh();
        }}>撤销</button
      >
      <button
        disabled={!loaded || saving || !editor.canRedo}
        onclick={() => {
          editor.redo();
          refresh();
        }}>重做</button
      >
      <button disabled={!loaded || saving} onclick={() => (showNew = true)}>新建像素源</button>
      <button disabled={!loaded || saving} onclick={() => saveDraft()}>保存草稿</button>
      <button class="primary" disabled={!loaded || saving} onclick={() => saveDraft(true)}>应用到游戏</button>
    </div>
  </header>
  <div class="layout">
    <AppearanceCenterNavigation
      assets={all}
      {objects}
      {thumbnails}
      selectedObjectId={objectId}
      {selectedContext}
      bind:resourceCategory
      onobject={selectObject}
      oncontext={selectContext}
      onresource={selectResource}
    />
    <main>
      {#if previewAsset}
        <div class="eyebrow">{selectedObject?.name ?? '资源'} / {selectedContext?.name ?? '资源编辑'}</div>
        <h1>{previewAsset.name}</h1>
        <p class="context-note">
          {selectedContext?.name === '放置'
            ? '放置表现使用共享面材质。'
            : selectedContext?.name === '掉落'
              ? '掉落物与模型共用外观源。'
              : selectedContext?.name === '手持'
                ? '手持表现与游戏内第一人称路径一致。'
                : '旋转查看对象的共享模型表现。'}
        </p>
        <section class="preview">
          <AssetPreview
            asset={previewAsset}
            assets={previewAssets}
            {revision}
            contextMode={selectedContext?.mode ?? 'model'}
          />
        </section>
        {#if slots.length}
          <AppearanceMaterialEditor
            modelId={previewAsset.id}
            {slots}
            assets={all}
            allowPrivate={canPrivateMaterials}
            onprivate={privateMaterial}
            onedit={editMaterial}
            ontexture={(asset) => selectResource(asset, true)}
          />
          {#if !canPrivateMaterials}<p class="shared-note">{sharedMaterialNote}</p>{/if}
        {/if}
      {:else}
        <p class="empty-state">正在加载对象目录…</p>
      {/if}
    </main>
    <AppearanceCenterInspector
      asset={focusAsset}
      texture={focusTexture}
      assets={all}
      {users}
      {revision}
      {saving}
      onselect={selectResource}
      onpaint={paint}
      onbegin={() => editor.checkpoint()}
      onmodeledit={editPixelModel}
      oncopy={copyNative}
      ondelete={deleteNative}
      onpalette={editPalette}
      onresize={resizeTexture}
      onreplaceimage={replaceImage}
      onreimport={glbActions.reimport}
      onexportglb={glbActions.export}
      ondeleteglb={glbActions.delete}
      onexport={exportProject}
      onimport={importProject}
      onlegacyimport={async (model) => {
        await refreshModels();
        const imported = modelAssets.find((asset) => asset.id === model.id);
        if (imported) selectResource(imported);
        refresh();
        notify(`静态 GLB 已导入并打开：${model.name}。`);
      }}
      onrestore={restore}
      onerror={(message) => notify(message, true)}
    />
  </div>
  <footer class:error={failed} role={failed ? 'alert' : 'status'}>{status}</footer>
</div>
{#if showNew}<NewAssetDialog onclose={() => (showNew = false)} oncreate={createNative} />{/if}

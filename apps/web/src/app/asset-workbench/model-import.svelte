<script lang="ts">
  import type { StoredGlb } from '../../client/presentation/glb-model';
  import { publicAssetUrl } from '../../client/presentation/public-asset-url';
  import { importGlbModel } from '../../client/persistence/glb-model-store';

  let {
    onimport,
    onerror,
  }: { onimport: (model: StoredGlb) => void | Promise<void>; onerror?: (message: string) => void } = $props();
  let input: HTMLInputElement;
  let importing = $state(false);
  let status = $state('');
  let failed = $state(false);

  async function importSelected(): Promise<void> {
    const file = input.files?.[0];
    if (!file || importing) return;
    importing = true;
    failed = false;
    status = `正在校验 ${file.name}…`;
    try {
      const model = await importGlbModel(file);
      status = `已导入 ${model.name}（${model.nodeCount} 节点，${model.triangleCount} 三角形）`;
      await onimport(model);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      status = message;
      failed = true;
      onerror?.(message);
    } finally {
      importing = false;
      input.value = '';
    }
  }
</script>

<div class="model-import">
  <button type="button" disabled={importing} onclick={() => input.click()}
    >{importing ? '正在导入…' : '导入静态 GLB'}</button
  >
  <a
    href={publicAssetUrl(import.meta.env.BASE_URL, 'models/voxel-settler-animated.glb')}
    download="seedlands-voxel-settler-animated.glb">下载骨骼动画样例</a
  >
  <input
    bind:this={input}
    type="file"
    accept=".glb,model/gltf-binary"
    aria-label="导入静态 GLB"
    hidden
    onchange={importSelected}
    disabled={importing}
  />
  <p aria-live="polite" class:error={failed}>
    {importing ? '正在导入 GLB…' : status || '自包含 GLB · 最大 16 MiB · 支持有界骨骼动画'}
  </p>
</div>

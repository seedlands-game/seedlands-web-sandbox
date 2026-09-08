<script lang="ts">
  import type { Asset } from '../../client/presentation/asset-types';
  import { assetDependencies } from '../../client/presentation/asset-adapters';
  import { deleteGlbModel, loadGlbBlob } from '../../client/persistence/glb-model-store';
  let {
    asset,
    assets,
    onselect,
    ondeleted,
    onerror,
  }: {
    asset: Asset;
    assets: Asset[];
    onselect: (id: string) => void;
    ondeleted: (id: string) => void;
    onerror: (message: string) => void;
  } = $props();
  let pending = $state(false);
  const dependencies = $derived(
    assetDependencies(asset)
      .map((id) => assets.find((a) => a.id === id))
      .filter((a): a is Asset => !!a),
  );
  async function download() {
    if (asset.type !== 'glb-model') return;
    try {
      const blob = await loadGlbBlob(asset.payload.modelId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${asset.name.replace(/\.glb$/i, '')}.glb`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      onerror(String(error));
    }
  }
  async function remove() {
    if (asset.type !== 'glb-model' || !confirm('删除此本地模型？已导出的文件不受影响。')) return;
    pending = true;
    try {
      await deleteGlbModel(asset.payload.modelId);
      ondeleted(asset.id);
    } catch (error) {
      onerror(String(error));
    } finally {
      pending = false;
    }
  }
</script>

{#if dependencies.length}
  <section class="dependencies">
    <h2>组成资源</h2>
    {#each dependencies as dependency (dependency.id)}<button onclick={() => onselect(dependency.id)}
        >{dependency.name} →</button
      >{/each}
  </section>
{/if}
{#if asset.type === 'material'}
  <dl>
    <dt>透明方式</dt>
    <dd>{asset.payload.renderMode}</dd>
    <dt>粗糙度 / 金属度</dt>
    <dd>{asset.payload.roughness} / {asset.payload.metalness}</dd>
    <dt>发光强度</dt>
    <dd>{asset.payload.emissiveIntensity}</dd>
  </dl>
  <p>预览使用游戏材质适配器。点击组成贴图可查看并复制编辑。</p>
{:else if asset.type === 'glb-model'}
  <dl>
    <dt>文件大小</dt>
    <dd>{(asset.payload.byteLength / 1024).toFixed(1)} KiB</dd>
    <dt>节点 / 三角形</dt>
    <dd>{asset.payload.nodeCount} / {asset.payload.triangleCount}</dd>
    <dt>状态</dt>
    <dd>静态模型 · 已保存 · 无玩法绑定</dd>
  </dl>
  <div class="buttons">
    <button disabled={pending} onclick={download}>导出原始 GLB</button><button disabled={pending} onclick={remove}
      >删除模型</button
    >
  </div>
  <p>保留模型原始数据与美术风格，预览自动居中。骨骼、动画和外链资源暂不支持。</p>
{/if}

<style>
  .dependencies {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 20px 0;
  }
  h2 {
    width: 100%;
    font-size: 13px;
  }
  dl {
    display: grid;
    grid-template-columns: 110px 1fr;
    gap: 8px;
    font-size: 12px;
  }
  dt,
  p {
    color: #a5b4a9;
  }
  dd {
    margin: 0;
  }
  p {
    font-size: 12px;
    line-height: 1.7;
  }
  .buttons {
    display: flex;
    gap: 8px;
  }
</style>

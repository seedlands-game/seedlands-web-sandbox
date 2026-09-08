<script lang="ts">
  import type { Asset } from '../../client/presentation/asset-types';
  import type { StoredGlb } from '../../client/presentation/glb-model';
  import { builtinItemBindings } from '../../client/presentation/asset-catalog';
  import { assetAdapter } from '../../client/presentation/asset-adapters';
  import AssetThumbnail from './asset-thumbnail.svelte';
  import ModelImport from './model-import.svelte';
  let {
    assets,
    selectedId,
    revision,
    loaded,
    mobileVisible,
    tab = $bindable('usage'),
    onselect,
    onreload,
    onimport,
    onmodel,
    onerror,
  }: {
    assets: Asset[];
    selectedId: string;
    revision: number;
    loaded: boolean;
    mobileVisible: boolean;
    tab: 'usage' | 'items' | 'assets';
    onselect: (id: string) => void;
    onreload: () => void;
    onimport: () => void;
    onmodel: (model: StoredGlb) => void;
    onerror: (message: string) => void;
  } = $props();
  let search = $state('');
  let filter = $state('all');
  const matches = (name: string, id: string) => `${name} ${id}`.toLowerCase().includes(search.toLowerCase());
  const listed = $derived(
    assets.filter(
      (asset) =>
        matches(asset.name, asset.id) &&
        (filter === 'all' || asset.type === filter || (filter === 'user' && asset.source === 'user')),
    ),
  );
  const groups = $derived([
    {
      name: '地形与方块',
      note: 'Chunk Mesh · 独立面材质',
      assets: assets.filter((a) => a.type === 'builtin-voxel-model'),
    },
    {
      name: '物品与掉落物',
      note: '同一物品源 · 手持 / 掉落',
      assets: assets.filter(
        (a) => a.type === 'builtin-item-model' || (a.source === 'builtin' && a.type === 'extruded-pixel-model'),
      ),
    },
    {
      name: '人物、生物与手臂',
      note: '共享游戏构件 · 默认方块风格',
      assets: assets.filter((a) => a.type === 'builtin-actor-model' || a.type === 'builtin-arm-model'),
    },
    {
      name: '界面与目标图标',
      note: '原始图像 · 对应界面适配',
      assets: assets.filter((a) => a.type === 'image-texture' && a.id.startsWith('seedlands:image/')),
    },
    { name: '导入模型', note: '自包含静态 GLB', assets: assets.filter((a) => a.type === 'glb-model') },
  ]);
</script>

<aside class="library pane" class:mobile-visible={mobileVisible}>
  <div class="section-heading">
    <h2>资产库</h2>
    <span>{assets.length}</span>
  </div>
  <div class="segmented">
    <button class:active={tab === 'usage'} onclick={() => (tab = 'usage')}>按用途</button>
    <button class:active={tab === 'items'} onclick={() => (tab = 'items')}>按物品</button>
    <button class:active={tab === 'assets'} onclick={() => (tab = 'assets')}>按资产</button>
  </div>
  <input class="search" aria-label="搜索资产" placeholder="搜索名称或标识…" bind:value={search} />
  {#if tab === 'assets'}<select aria-label="资产类型筛选" bind:value={filter}>
      <option value="all">所有类型</option><option value="user">我的资产</option>
      {#each ['pixel-texture', 'material', 'extruded-pixel-model', 'image-texture', 'builtin-item-model', 'builtin-voxel-model', 'builtin-actor-model', 'builtin-arm-model', 'glb-model'] as type (type)}
        <option value={type}>{assetAdapter(type as Asset['type']).label}</option>
      {/each}
    </select>{/if}
  <div class="asset-list">
    {#if tab === 'usage'}
      {#each groups as group (group.name)}
        <div class="group-heading"><strong>{group.name}</strong><small>{group.note}</small></div>
        {#each group.assets.filter((a) => matches(a.name, a.id)) as asset (asset.id)}
          <button class="asset-row" class:selected={selectedId === asset.id} onclick={() => onselect(asset.id)}>
            <AssetThumbnail {asset} {assets} {revision} /><span
              ><strong>{asset.name}</strong><small>{assetAdapter(asset.type).label}</small></span
            >
          </button>
        {/each}
        {#if !group.assets.length}<p class="empty">导入后会在这里显示</p>{/if}
      {/each}
    {:else if tab === 'items'}
      {#each builtinItemBindings.filter((b) => matches(b.name, b.itemId)) as binding (binding.itemId)}
        {@const asset = assets.find((a) => a.id === binding.modelId)!}
        <button
          class="asset-row"
          class:selected={selectedId === binding.modelId || selectedId === binding.iconId}
          onclick={() => onselect(binding.modelId)}
        >
          <AssetThumbnail {asset} {assets} {revision} /><span
            ><strong>{binding.name}</strong><small>手持 · 掉落 · 库存</small></span
          >
        </button>
        {#if selectedId === binding.modelId || selectedId === binding.iconId}<div class="item-links">
            <button onclick={() => onselect(binding.modelId)}>模型</button><button
              onclick={() => onselect(binding.iconId)}>图标 / 贴图</button
            >
          </div>{/if}
      {/each}
    {:else}
      {#each listed as asset (asset.id)}
        <button class="asset-row" class:selected={selectedId === asset.id} onclick={() => onselect(asset.id)}>
          <AssetThumbnail {asset} {assets} {revision} /><span
            ><strong>{asset.name}</strong><small
              >{asset.source === 'user' ? '本地 · ' : ''}{assetAdapter(asset.type).label}</small
            ></span
          >
        </button>
      {/each}
      {#if !listed.length}<p class="empty">没有匹配的资产</p>{/if}
    {/if}
  </div>
  <div class="library-footer">
    <div>
      <button disabled={!loaded} onclick={onimport}>导入像素包</button><button onclick={onreload}>重新加载</button>
    </div>
    <ModelImport onimport={onmodel} {onerror} />
    <small>源数据保存在此浏览器 · 导出可备份</small>
  </div>
</aside>

<style>
  .group-heading {
    padding: 18px 10px 7px;
    display: grid;
    gap: 5px;
  }
  .group-heading strong {
    font-size: 12px;
    color: #d3c493;
  }
  .group-heading small {
    font-size: 10px;
    color: #93a699;
  }
  .library-footer {
    font-size: 11px;
  }
</style>

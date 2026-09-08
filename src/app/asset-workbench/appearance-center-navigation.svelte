<script lang="ts">
  import type { Asset } from '../../client/presentation/asset-types';
  import { builtinItemBindings } from '../../client/presentation/asset-catalog';
  import type { AppearanceContext, AppearanceObject } from '../../client/presentation/appearance-catalog';
  import { publicAssetUrl } from '../../client/presentation/public-asset-url';

  let {
    assets,
    objects,
    thumbnails,
    selectedObjectId,
    selectedContext,
    resourceCategory = $bindable('model'),
    onobject,
    oncontext,
    onresource,
  }: {
    assets: Asset[];
    objects: AppearanceObject[];
    thumbnails: Record<string, string>;
    selectedObjectId: string;
    selectedContext: AppearanceContext | undefined;
    resourceCategory: 'model' | 'material' | 'image';
    onobject: (id: string) => void;
    oncontext: (context: AppearanceContext) => void;
    onresource: (asset: Asset) => void;
  } = $props();

  let search = $state('');
  let section = $state<'objects' | 'resources'>('objects');
  let source = $state<'all' | 'builtin' | 'user'>('all');
  const matchingObjects = $derived(
    objects.filter((entry) => `${entry.name} ${entry.id}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())),
  );
  const resources = $derived(
    assets.filter(
      (asset) =>
        (resourceCategory === 'model'
          ? !['material', 'pixel-texture', 'image-texture'].includes(asset.type)
          : resourceCategory === 'material'
            ? asset.type === 'material'
            : asset.type === 'pixel-texture' || asset.type === 'image-texture') &&
        (source === 'all' || asset.source === source) &&
        `${asset.name} ${asset.id}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
    ),
  );
  const builtinThumbnail = (object: AppearanceObject) => {
    const item = builtinItemBindings.find((binding) => binding.modelId === object.id);
    return item ? publicAssetUrl(import.meta.env.BASE_URL, `assets/item-thumbnails/${item.itemId}.png`) : undefined;
  };
</script>

<aside class="navigation" aria-label="外观对象与资源">
  <div class="heading">
    <div>
      <span>SEEDLANDS</span>
      <h1>对象外观</h1>
    </div>
    <small>{objects.length} 个对象</small>
  </div>
  <div class="sections" role="tablist" aria-label="导航方式">
    <button class:active={section === 'objects'} onclick={() => (section = 'objects')}>对象</button>
    <button class:active={section === 'resources'} onclick={() => (section = 'resources')}>资源</button>
  </div>
  <input class="search" aria-label="搜索对象或资源" placeholder="搜索名称…" bind:value={search} />
  {#if section === 'objects'}
    <div class="list">
      {#each matchingObjects as object (object.id)}
        {@const thumbnail = thumbnails[object.id] ?? builtinThumbnail(object)}
        <button class="object" class:selected={selectedObjectId === object.id} onclick={() => onobject(object.id)}>
          {#if thumbnail}<img src={thumbnail} alt="" />{:else}<span class="fallback">3D</span>{/if}
          <span
            ><strong>{object.name}</strong><small>{object.contexts.length > 1 ? '多场景表现' : '模型检视'}</small></span
          >
        </button>
        {#if selectedObjectId === object.id}
          <div class="contexts" aria-label={`${object.name} 的表现方式`}>
            {#each object.contexts as context (`${context.name}:${context.assetId}`)}
              <button
                class:active={selectedContext?.name === context.name && selectedContext.assetId === context.assetId}
                onclick={() => oncontext(context)}>{context.name}</button
              >
            {/each}
          </div>
        {/if}
      {:else}
        <p class="empty">没有匹配对象</p>
      {/each}
    </div>
  {:else}
    <div class="categories" aria-label="资源类型">
      {#each [['model', '模型'], ['material', '材质'], ['image', '图像']] as [id, name] (id)}
        <button
          class:active={resourceCategory === id}
          onclick={() => (resourceCategory = id as typeof resourceCategory)}>{name}</button
        >
      {/each}
    </div>
    <div class="categories" aria-label="资源来源">
      {#each [['all', '所有'], ['builtin', '内置'], ['user', '我的']] as [id, name] (id)}
        <button class:active={source === id} onclick={() => (source = id as typeof source)}>{name}</button>
      {/each}
    </div>
    <div class="list">
      {#each resources as resource (resource.id)}
        <button class="resource" onclick={() => onresource(resource)}
          ><strong>{resource.name}</strong><small>{resource.id}</small></button
        >
      {:else}
        <p class="empty">没有匹配资源</p>
      {/each}
    </div>
  {/if}
</aside>

<style>
  .navigation {
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: #16221b;
    border-right: 1px solid #334438;
    padding: 20px 13px;
  }
  .heading,
  .object,
  .resource {
    display: flex;
    align-items: center;
    gap: 10px;
    text-align: left;
  }
  .heading {
    justify-content: space-between;
    padding: 0 7px 16px;
  }
  .heading span,
  .heading small,
  small {
    color: #91a99a;
    font-size: 10px;
  }
  h1 {
    margin: 2px 0 0;
    font-size: 18px;
    font-weight: 600;
  }
  .sections,
  .categories,
  .contexts {
    display: flex;
    gap: 4px;
    padding: 3px;
    border-radius: 7px;
    background: #0f1a14;
  }
  .sections {
    margin-bottom: 12px;
  }
  .sections button,
  .categories button,
  .contexts button {
    flex: 1;
    border: 0;
    background: transparent;
    color: #98aa9c;
    padding: 7px;
  }
  .sections button.active,
  .categories button.active,
  .contexts button.active {
    background: #3b523c;
    color: #eef0df;
  }
  .search {
    width: 100%;
    margin-bottom: 10px;
  }
  .list {
    overflow: auto;
    min-height: 0;
  }
  .object,
  .resource {
    width: 100%;
    border: 1px solid transparent;
    background: transparent;
    color: inherit;
    padding: 8px;
    margin: 2px 0;
  }
  .object.selected {
    background: #304536;
    border-color: #637554;
    box-shadow: inset 3px 0 #c5ad70;
  }
  .object img,
  .fallback {
    width: 38px;
    height: 38px;
    border-radius: 6px;
    object-fit: contain;
    background: #0f1713;
    image-rendering: pixelated;
    display: grid;
    place-items: center;
    color: #c2b379;
    font-size: 10px;
  }
  strong,
  small {
    display: block;
    overflow-wrap: anywhere;
  }
  strong {
    font-size: 12px;
  }
  small {
    margin-top: 3px;
  }
  .contexts {
    margin: 0 8px 7px 55px;
  }
  .contexts button {
    font-size: 10px;
  }
  .categories {
    margin-bottom: 10px;
  }
  .resource {
    display: block;
  }
  .resource small {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .empty {
    padding: 18px 8px;
    color: #91a99a;
    font-size: 12px;
  }
</style>

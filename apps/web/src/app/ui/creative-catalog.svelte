<script lang="ts">
  import type { ShellState, UiActionPort } from './ui-contracts';
  import GameButton from './primitives/game-button.svelte';
  import GameTextField from './primitives/game-text-field.svelte';
  import ItemIcon from './primitives/item-icon.svelte';

  let { gameplay, actions }: { gameplay: ShellState['gameplay']; actions: UiActionPort } = $props();
  let filter = $state('');
  const visibleItems = $derived(
    gameplay.creativeCatalog.filter((item) => item.name.toLowerCase().includes(filter.trim().toLowerCase())),
  );
</script>

<section id="creative-catalog" class="creative-catalog" aria-label="创造内容目录">
  <div class="catalog-heading">
    <div>
      <h3>内容目录</h3>
      <p>选择物品放入创造快捷栏 {gameplay.selectedHotbarSlot + 1}；不会改变生存库存。</p>
    </div>
    <GameButton
      label={`清空创造快捷栏 ${gameplay.selectedHotbarSlot + 1}`}
      onclick={() => actions.setCreativeSlot(gameplay.selectedHotbarSlot, null)}>清空当前槽</GameButton
    >
  </div>
  <GameTextField id="creative-item-filter" label="筛选物品" bind:value={filter} placeholder="输入物品名" />
  <div class="catalog-grid" role="list" aria-label="可用创造物品">
    {#each visibleItems as item (item.itemId)}
      <div role="listitem">
        <button
          type="button"
          aria-label={`将${item.name}放入创造快捷栏 ${gameplay.selectedHotbarSlot + 1}`}
          data-item={item.itemId}
          onclick={() => actions.setCreativeSlot(gameplay.selectedHotbarSlot, item.itemId)}
        >
          <ItemIcon itemId={item.itemId} />
          <strong>{item.name}</strong>
        </button>
      </div>
    {:else}
      <p>没有符合筛选条件的物品。</p>
    {/each}
  </div>
</section>

<style>
  .creative-catalog {
    display: grid;
    gap: 12px;
  }
  .catalog-heading {
    display: flex;
    align-items: start;
    justify-content: space-between;
    gap: 16px;
  }
  :global(#ui #creative-catalog .catalog-heading .game-button) {
    width: auto;
    flex-shrink: 0;
  }
  h3,
  p {
    margin: 0;
  }
  p {
    color: var(--ui-color-content-muted);
  }
  .catalog-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(var(--classic-slot-size), 1fr));
    height: clamp(216px, 38dvh, 320px);
    align-content: start;
    gap: 5px;
    overflow-y: auto;
    padding: 2px;
    scrollbar-gutter: stable;
  }
  .catalog-grid button {
    display: grid;
    width: 100%;
    min-height: calc(var(--classic-slot-size) + 14px);
    place-items: center;
    gap: 2px;
    border: var(--classic-slot-border);
    border-radius: 0;
    background: var(--classic-slot-surface);
    box-shadow: inset 1px 1px 0 #626262;
    color: #e9dfca;
  }
  .catalog-grid button:hover {
    border-color: #c8c8c8;
    background: var(--classic-slot-hover-surface);
  }
  .catalog-grid :global(.item-icon) {
    width: min(34px, calc(var(--classic-slot-size) - 14px));
    height: min(34px, calc(var(--classic-slot-size) - 14px));
    image-rendering: pixelated;
  }
  .catalog-grid strong {
    max-width: 100%;
    overflow: hidden;
    color: #e9dfca;
    font-size: 10px;
    line-height: 1.1;
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  @media (max-width: 720px) {
    .catalog-grid {
      grid-template-columns: repeat(auto-fill, minmax(var(--classic-slot-size), 1fr));
      height: clamp(192px, 36dvh, 260px);
    }
    .catalog-heading {
      align-items: stretch;
      flex-direction: column;
    }
  }
</style>

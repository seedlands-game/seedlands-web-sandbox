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
          <small>{item.itemId}</small>
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
    gap: 14px;
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
  p,
  small {
    color: var(--ui-color-content-muted);
  }
  .catalog-grid {
    display: grid;
    grid-template-columns: repeat(6, minmax(90px, 1fr));
    gap: 8px;
  }
  .catalog-grid button {
    display: grid;
    width: 100%;
    min-height: 86px;
    place-items: center;
    gap: 4px;
    border: 1px solid #62533d;
    border-radius: 3px;
    background: #121819;
    color: #e9dfca;
  }
  .catalog-grid button:hover {
    border-color: #d1aa60;
    background: #233b3b;
  }
  .catalog-grid :global(.item-icon) {
    width: 46px;
    height: 46px;
    image-rendering: pixelated;
  }
  .catalog-grid small {
    max-width: 100%;
    overflow-wrap: anywhere;
    font-size: 9px;
  }
  @media (max-width: 720px) {
    .catalog-grid {
      grid-template-columns: repeat(3, minmax(80px, 1fr));
    }
    .catalog-heading {
      align-items: stretch;
      flex-direction: column;
    }
  }
</style>

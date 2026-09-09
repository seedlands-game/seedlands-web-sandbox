<script lang="ts">
  import GameButton from './primitives/game-button.svelte';
  import GameOverlay from './primitives/game-overlay.svelte';
  import GameTextField from './primitives/game-text-field.svelte';
  import type { ShellState, UiActionPort } from './ui-contracts';
  import ItemIcon from './primitives/item-icon.svelte';
  import CreativeCatalog from './creative-catalog.svelte';

  let { gameplay, actions }: { gameplay: ShellState['gameplay']; actions: UiActionPort } = $props();
  let filter = $state('');
  let pickedSlot = $state<number | null>(null);
  const pickedItem = $derived(pickedSlot === null ? null : gameplay.inventory[pickedSlot]);
  const edible = $derived(pickedItem?.edible ?? false);
  $effect(() => {
    if (!gameplay.inventoryOpen) pickedSlot = null;
  });
  function pickSlot(slot: number) {
    if (pickedSlot === null) {
      if (gameplay.inventory[slot].itemId) pickedSlot = slot;
    } else {
      if (pickedSlot !== slot) actions.moveInventorySlot(pickedSlot, slot);
      pickedSlot = null;
    }
  }
  const visibleRecipes = $derived(
    gameplay.recipes.filter((recipe) => recipe.name.toLowerCase().includes(filter.trim().toLowerCase())),
  );

  function handleKey(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    actions.closeInventory();
  }
</script>

<GameOverlay
  id="inventory-crafting"
  label={gameplay.mode === 'creative' ? '创造内容目录' : '背包与合成'}
  open={gameplay.inventoryOpen}
  onkeydown={handleKey}
>
  <div class="inventory-dialog">
    <header>
      <div>
        <small id="actor-mode-status" role="status">{gameplay.mode === 'creative' ? '创造模式' : '生存模式'}</small>
        <h2>{gameplay.mode === 'creative' ? '创造内容目录' : '背包与合成'}</h2>
      </div>
      <div class="mode-actions">
        {#if gameplay.mode === 'creative'}
          <GameButton
            label={gameplay.flightEnabled ? '关闭飞行' : '开启飞行'}
            onclick={() => actions.setFlight(!gameplay.flightEnabled)}
            >{gameplay.flightEnabled ? '关闭飞行' : '开启飞行'}</GameButton
          >
          <GameButton label="切换生存模式" onclick={() => actions.setActorMode('survival')}>切换生存</GameButton>
        {:else}
          <GameButton label="切换创造模式" onclick={() => actions.setActorMode('creative')}>切换创造</GameButton>
        {/if}
        <GameButton label="关闭背包" onclick={actions.closeInventory}>关闭</GameButton>
      </div>
    </header>
    {#if gameplay.mode === 'creative'}
      <div class="creative-guidance" role="status">
        {gameplay.flightEnabled ? '飞行中：Space 上升，Shift 下降。' : '飞行已关闭；可随时重新开启。'}
      </div>
      <CreativeCatalog {gameplay} {actions} />
    {:else}
      <GameTextField id="recipe-filter" label="筛选配方" bind:value={filter} placeholder="输入物品名" />
      <div class="inventory-selection" role="status" aria-label="背包操作提示">
        <p>
          {pickedItem?.itemId
            ? `已选 ${pickedItem.name}：点击目标格移动、合并或交换。`
            : '点击物品，再点击目标格移动。前八格是快捷栏。'}
        </p>
        <div class="inventory-actions">
          <GameButton
            label="装备到当前快捷栏"
            disabled={pickedSlot === null || pickedSlot === gameplay.selectedHotbarSlot}
            onclick={() => {
              if (pickedSlot !== null) actions.moveInventorySlot(pickedSlot, gameplay.selectedHotbarSlot);
              pickedSlot = null;
            }}>放入快捷栏 {gameplay.selectedHotbarSlot + 1}</GameButton
          >
          <GameButton
            label={`食用${pickedItem?.name ?? '食物'}`}
            disabled={!edible}
            onclick={() => {
              if (pickedSlot !== null) actions.useInventoryItem(pickedSlot);
            }}>食用</GameButton
          >
        </div>
      </div>
      <div class="inventory-layout">
        <div class="inventory-grid" role="grid" aria-label="背包槽位">
          {#each gameplay.inventory as slot (slot.slot)}
            <button
              type="button"
              role="gridcell"
              aria-label={`${slot.name} ${slot.count}`}
              aria-selected={slot.slot === gameplay.selectedHotbarSlot}
              class:active={slot.slot === gameplay.selectedHotbarSlot}
              class:picked={slot.slot === pickedSlot}
              data-item={slot.itemId ?? 'empty'}
              data-slot={slot.slot}
              onclick={() => pickSlot(slot.slot)}
            >
              <ItemIcon itemId={slot.itemId} />
              <span class="inventory-item-name">{slot.itemId ? slot.name : ''}</span>
              <small>{slot.slot + 1}</small>
              {#if slot.count > 0}<strong>{slot.count}</strong>{/if}
            </button>
          {/each}
        </div>
        <section class="recipe-list" aria-label="合成配方">
          <h3>合成配方</h3>
          <div role="list" aria-label="合成配方">
            {#each visibleRecipes as recipe (recipe.id)}
              <div role="listitem" class:available={recipe.craftable}>
                <div>
                  <strong>{recipe.name}</strong>
                  <small>{recipe.requirements} → {recipe.result}</small>
                </div>
                <GameButton
                  label={`${recipe.craftable ? '合成' : '缺少材料'} ${recipe.name}`}
                  disabled={!recipe.craftable}
                  onclick={() => actions.craftRecipe(recipe.id)}
                >
                  {recipe.craftable ? '合成' : '缺材料'}
                </GameButton>
              </div>
            {:else}
              <p>没有符合筛选条件的配方。</p>
            {/each}
          </div>
        </section>
      </div>
    {/if}
  </div>
</GameOverlay>

<style>
  .mode-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: end;
    gap: 8px;
  }
  :global(#ui #inventory-crafting .mode-actions .game-button) {
    width: auto;
  }
  .creative-guidance {
    margin-bottom: 14px;
    padding: 10px 12px;
    border: 1px solid #756140;
    background: #171c1c;
    color: #d0c4ac;
    font-size: 12px;
  }
</style>

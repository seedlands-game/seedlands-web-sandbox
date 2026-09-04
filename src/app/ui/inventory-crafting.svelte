<script lang="ts">
  import GameButton from './primitives/game-button.svelte';
  import GameOverlay from './primitives/game-overlay.svelte';
  import GameTextField from './primitives/game-text-field.svelte';
  import type { ShellState, UiActionPort } from './ui-contracts';

  let { gameplay, actions }: { gameplay: ShellState['gameplay']; actions: UiActionPort } = $props();
  let filter = $state('');
  const visibleRecipes = $derived(
    gameplay.recipes.filter((recipe) => recipe.name.toLowerCase().includes(filter.trim().toLowerCase())),
  );

  function handleKey(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    actions.closeInventory();
  }
</script>

<GameOverlay id="inventory-crafting" label="背包与合成" open={gameplay.inventoryOpen} onkeydown={handleKey}>
  <div class="inventory-dialog">
    <header>
      <div>
        <small>生存装备</small>
        <h2>背包与合成</h2>
      </div>
      <GameButton label="关闭背包" onclick={actions.closeInventory}>关闭</GameButton>
    </header>
    <GameTextField id="recipe-filter" label="筛选配方" bind:value={filter} placeholder="输入物品名" />
    <div class="inventory-layout">
      <div class="inventory-grid" role="grid" aria-label="背包槽位">
        {#each gameplay.inventory as slot (slot.slot)}
          <button
            type="button"
            role="gridcell"
            aria-label={`${slot.name} ${slot.count}`}
            aria-selected={slot.slot === gameplay.selectedHotbarSlot}
            class:active={slot.slot === gameplay.selectedHotbarSlot}
            data-item={slot.itemId ?? 'empty'}
          >
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
  </div>
</GameOverlay>

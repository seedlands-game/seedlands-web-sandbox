<script lang="ts">
  import type { GameplayItemPresentation } from './gameplay-ui-projector';
  import type { InventoryUiSlot } from './inventory-pointer-gestures';
  import type { StationUiPresentation } from './station-ui-projector';
  import InventorySlot from './primitives/inventory-slot.svelte';
  import ItemIcon from './primitives/item-icon.svelte';

  let {
    slots,
    recipes,
    cursor,
    previews,
    onpress,
    onenter,
    onactivate,
    oncraft,
  }: {
    slots: readonly GameplayItemPresentation[];
    recipes: StationUiPresentation['recipes'];
    cursor: GameplayItemPresentation | null;
    previews: ReadonlyMap<string, number>;
    onpress: (event: PointerEvent, address: InventoryUiSlot) => void;
    onenter: (address: InventoryUiSlot) => void;
    onactivate: (address: InventoryUiSlot) => void;
    oncraft: (batch: boolean) => void;
  } = $props();

  let recipeBookOpen = $state(false);
  const result = $derived(recipes.find((recipe) => recipe.matchesGrid));
</script>

<section class="personal-crafting" aria-label="随身合成">
  <div class="crafting-title">
    <h3>合成</h3>
    <span>2×2</span>
  </div>
  <div class="crafting-row">
    <div class="crafting-grid" role="grid" aria-label="随身合成槽位">
      {#each slots as item (item.slot)}
        <InventorySlot
          {item}
          address={{ kind: 'crafting', slot: item.slot }}
          label={`合成格 ${item.slot + 1}`}
          preview={previews.get(`crafting:${item.slot}`)}
          previewItem={cursor}
          {onpress}
          {onenter}
          {onactivate}
        />
      {/each}
    </div>
    <span class="craft-arrow" aria-hidden="true">→</span>
    <button
      type="button"
      class="craft-result"
      data-personal-craft-result
      data-item={result?.output?.itemId ?? 'empty'}
      aria-label={result ? `取出 ${result.name}` : '合成结果：请放入材料'}
      disabled={!result}
      title="点击取出一份 · Shift 点击尽可能合成"
      oncontextmenu={(event) => event.preventDefault()}
      onpointerdown={(event) => {
        if (event.button === 2) {
          event.preventDefault();
          oncraft(event.shiftKey);
        }
      }}
      onclick={(event) => oncraft(event.shiftKey)}
    >
      <ItemIcon itemId={result?.output?.itemId ?? null} />
      {#if result?.output}<strong>{result.output.count}</strong>{/if}
    </button>
  </div>
  <details class="recipe-book" bind:open={recipeBookOpen}>
    <summary>配方手册 <span>{recipes.length} 个 2×2 配方</span></summary>
    {#if recipeBookOpen}
      <div class="recipes">
        {#each recipes as recipe (recipe.id)}
          <article class:matched={recipe.matchesGrid} data-recipe={recipe.id}>
            <strong>{recipe.name}</strong>
            <div class="recipe-pattern" aria-label={`${recipe.name}材料`}>
              {#each recipe.pattern as item (item.slot)}<span title={item.name}>
                  <ItemIcon itemId={item.itemId} />
                </span>{/each}
            </div>
            <small>{recipe.requirements}</small>
          </article>
        {/each}
      </div>
    {/if}
  </details>
</section>

<style>
  .personal-crafting {
    padding: 0 0 16px;
    border-bottom: 1px solid #83704b60;
  }
  .crafting-title {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin-bottom: 10px;
  }
  h3 {
    margin: 0;
    color: #e6d3ad;
    font-size: 14px;
  }
  .crafting-title span,
  summary span {
    color: #9c9989;
    font-size: 10px;
  }
  .crafting-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 22px;
  }
  .crafting-grid {
    display: grid;
    grid-template-columns: repeat(2, var(--classic-slot-size));
    gap: 5px;
  }
  .craft-arrow {
    color: #c1ae83;
    font-size: 32px;
  }
  .craft-result {
    position: relative;
    display: grid;
    place-items: center;
    width: 72px;
    height: 72px;
    padding: 10px;
    border: 2px solid #baa477;
    border-radius: 3px;
    background: #26302a;
    cursor: pointer;
  }
  .craft-result:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .craft-result:hover:enabled {
    border-color: #e4d399;
    background: #42553c;
  }
  .craft-result :global(.item-icon) {
    width: 52px;
    height: 52px;
    object-fit: contain;
    image-rendering: pixelated;
  }
  .craft-result > strong {
    position: absolute;
    right: 5px;
    bottom: 5px;
    font: 700 14px monospace;
  }
  .recipe-book {
    margin-top: 12px;
    font-size: 12px;
  }
  summary {
    color: #dfccaa;
    cursor: pointer;
  }
  summary span {
    margin-left: 8px;
  }
  .recipes {
    display: flex;
    overflow-x: auto;
    gap: 10px;
    padding: 10px 0 2px;
  }
  article {
    flex: 0 0 128px;
    display: grid;
    gap: 6px;
    padding: 8px;
    border: 1px solid #77624370;
  }
  article.matched {
    border-color: #baa477;
    background: #ffffff08;
  }
  article > strong {
    font-size: 11px;
  }
  article small {
    color: #b2aa98;
    font-size: 10px;
  }
  .recipe-pattern {
    display: grid;
    grid-template-columns: repeat(2, 22px);
    gap: 2px;
  }
  .recipe-pattern span {
    width: 22px;
    height: 22px;
    background: #ffffff10;
  }
  .recipe-pattern :global(.item-icon) {
    width: 22px;
    height: 22px;
    object-fit: contain;
    image-rendering: pixelated;
  }
</style>

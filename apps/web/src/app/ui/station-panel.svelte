<script lang="ts">
  import type { StationUiPresentation } from './station-ui-projector';
  import type { UiActionPort } from './ui-contracts';
  import ItemIcon from './primitives/item-icon.svelte';
  import GameButton from './primitives/game-button.svelte';
  let {
    station,
    actions,
    actorSlot,
    selectedSlot,
    onpick,
    onused,
  }: {
    station: StationUiPresentation;
    actions: UiActionPort;
    actorSlot: number | null;
    selectedSlot: number | null;
    onpick: (slot: number, count?: number) => void;
    onused: () => void;
  } = $props();
  let wholeStack = $state(false);
  function pick(slot: number) {
    const count = wholeStack ? undefined : 1;
    if (actorSlot === null) onpick(slot, count);
    else {
      actions.stationAction({ kind: 'transfer', from: 'actor', actorSlot, stationSlot: slot, count });
      onused();
    }
  }
</script>

<section class="station-panel" aria-label={`${station.name}操作`} data-station-kind={station.kind}>
  <h3>{station.name}</h3>
  <p>先选背包物品，再点工位格放入；先选工位物品，再点背包格取出。</p>
  <label class="transfer-size"><input type="checkbox" bind:checked={wholeStack} /> 每次移动整组（默认一个）</label>
  <div class="station-grid" class:chest={station.kind === 'chest'} role="grid" aria-label={`${station.name}槽位`}>
    {#each station.slots as slot (slot.slot)}
      <button
        type="button"
        role="gridcell"
        class:selected={selectedSlot === slot.slot}
        aria-selected={selectedSlot === slot.slot}
        aria-label={`${station.kind === 'furnace' ? ['原料', '燃料', '产出'][slot.slot] : `工位格 ${slot.slot + 1}`}：${slot.name} ${slot.count}`}
        data-station-slot={slot.slot}
        data-item={slot.itemId ?? 'empty'}
        onclick={() => pick(slot.slot)}
      >
        {#if station.kind === 'furnace'}<small>{['原料', '燃料', '产出'][slot.slot]}</small>{/if}
        <ItemIcon itemId={slot.itemId} /><span>{slot.itemId ? slot.name : '空'}</span>
        {#if slot.count}<strong>{slot.count}</strong>{/if}
      </button>
    {/each}
  </div>
  {#if station.kind === 'furnace'}
    <label class="smelting">冶炼进度 <progress value={station.progress} max="1"></progress></label>
    <p role="status">剩余燃烧时间 {station.fuelSeconds.toFixed(1)} 秒 · 放入粗铁和煤炭或原木</p>
  {/if}
  {#if station.kind === 'workbench'}
    <h4>工作台配方</h4>
    <div class="station-recipes">
      {#each station.recipes as recipe (recipe.id)}
        <article>
          <strong>{recipe.name}</strong>
          {#if recipe.pattern.length}
            <div class="recipe-pattern" aria-label={`${recipe.name}摆放图`}>
              {#each recipe.pattern as slot (slot.slot)}<span title={slot.name}><ItemIcon itemId={slot.itemId} /></span
                >{/each}
            </div>
          {/if}
          <small>{recipe.requirements}</small>
          <GameButton
            label={`工作台合成${recipe.name}`}
            disabled={!recipe.craftable}
            onclick={() => actions.stationAction({ kind: 'craft', recipeId: recipe.id })}>合成</GameButton
          >
        </article>
      {/each}
    </div>
  {/if}
</section>

<style>
  .transfer-size {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  :global(#ui .inventory-dialog .transfer-size input[type='checkbox']) {
    width: 16px;
    height: 16px;
    min-height: 16px;
    padding: 0;
    margin-right: 6px;
  }
  .station-panel {
    margin-top: 1rem;
    border-top: 1px solid #ffffff30;
    padding-top: 1rem;
  }
  .station-panel p,
  .transfer-size {
    font-size: 0.85rem;
  }
  .station-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 90px));
    gap: 6px;
    margin: 12px 0;
  }
  .station-grid.chest {
    grid-template-columns: repeat(6, minmax(0, 1fr));
  }
  .station-grid button {
    color: inherit;
    background: #1b252bcc;
    border: 1px solid #ffffff35;
    border-radius: 6px;
    min-height: 72px;
    padding: 5px;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .station-grid button.selected {
    outline: 2px solid #ffd36d;
  }
  .station-grid button :global(img) {
    width: 26px;
    height: 26px;
    image-rendering: pixelated;
  }
  .station-grid button span {
    font-size: 0.75rem;
  }
  .smelting {
    display: flex;
    gap: 1rem;
    align-items: center;
  }
  .station-recipes {
    display: flex;
    gap: 12px;
    overflow-x: auto;
    padding-bottom: 8px;
  }
  .station-recipes article {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    flex: 0 0 140px;
    border: 1px solid #ffffff20;
    padding: 10px;
    border-radius: 8px;
  }
  .recipe-pattern {
    display: grid;
    grid-template-columns: repeat(3, 24px);
    gap: 2px;
  }
  .recipe-pattern span {
    width: 24px;
    height: 24px;
    background: #ffffff15;
  }
  .recipe-pattern :global(img) {
    width: 24px;
    height: 24px;
    image-rendering: pixelated;
  }
</style>

<script lang="ts">
  import type { StationUiPresentation } from './station-ui-projector';
  import type { GameplayItemPresentation } from './gameplay-ui-projector';
  import type { InventoryUiSlot } from './inventory-pointer-gestures';
  import InventorySlot from './primitives/inventory-slot.svelte';
  import ItemIcon from './primitives/item-icon.svelte';
  let {
    station,
    cursor,
    previews,
    onpress,
    onenter,
    onactivate,
    oncraft,
  }: {
    station: StationUiPresentation;
    cursor: GameplayItemPresentation | null;
    previews: ReadonlyMap<string, number>;
    onpress: (event: PointerEvent, address: InventoryUiSlot) => void;
    onenter: (address: InventoryUiSlot) => void;
    onactivate: (address: InventoryUiSlot) => void;
    oncraft: (batch: boolean) => void;
  } = $props();
  const result = $derived(station.recipes.find((recipe) => recipe.matchesGrid));
</script>

<section class="station-panel" aria-label={`${station.name}操作`} data-station-kind={station.kind}>
  <h3>{station.name}</h3>
  <div class="station-working-area">
    <div
      class="station-grid"
      class:chest={station.kind === 'chest'}
      class:furnace={station.kind === 'furnace'}
      role="grid"
      aria-label={`${station.name}槽位`}
    >
      {#each station.slots as item (item.slot)}
        <div class="station-cell">
          {#if station.kind === 'furnace'}<small>{['原料', '燃料', '产出'][item.slot]}</small>{/if}
          <InventorySlot
            {item}
            address={{ kind: 'station', slot: item.slot }}
            label={station.kind === 'furnace' ? ['原料', '燃料', '产出'][item.slot] : `工位格 ${item.slot + 1}`}
            preview={previews.get(`station:${item.slot}`)}
            previewItem={cursor}
            {onpress}
            {onenter}
            {onactivate}
          />
        </div>
      {/each}
    </div>
    {#if station.kind === 'workbench'}
      <span class="craft-arrow" aria-hidden="true">→</span>
      <div class="result-wrap">
        <small>合成结果</small>
        <button
          type="button"
          class="craft-result"
          data-craft-result
          data-item={result?.output?.itemId ?? 'empty'}
          aria-label={result ? `取出 ${result.name}` : '合成结果：请按配方摆放材料'}
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
        <span>{result?.name ?? '摆放材料后取出'}</span>
      </div>
    {/if}
  </div>
  {#if station.kind === 'furnace'}
    <div class="smelting">
      <label>冶炼进度 <progress value={station.progress} max="1"></progress></label><span
        >剩余燃烧时间 {station.fuelSeconds.toFixed(1)} 秒</span
      >
    </div>
  {/if}
  {#if station.kind === 'workbench'}
    <details class="station-recipe-book">
      <summary>配方手册 <span>查看摆放图</span></summary>
      <div class="station-recipes">
        {#each station.recipes as recipe (recipe.id)}
          <article>
            <strong>{recipe.name}</strong>
            {#if recipe.pattern.length}<div class="recipe-pattern" aria-label={`${recipe.name}摆放图`}>
                {#each recipe.pattern as item (item.slot)}<span title={item.name}
                    ><ItemIcon itemId={item.itemId} /></span
                  >{/each}
              </div>{/if}
            <small>{recipe.requirements}</small>
          </article>
        {/each}
      </div>
    </details>
  {/if}
</section>

<style>
  .station-panel {
    padding: 0 0 16px;
    border-bottom: 1px solid #83704b60;
  }
  h3 {
    margin: 0 0 12px;
    font-size: 14px;
    color: #e6d3ad;
  }
  .station-working-area {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 24px;
  }
  .station-grid {
    display: grid;
    grid-template-columns: repeat(3, 58px);
    gap: 5px;
  }
  .station-grid.chest {
    grid-template-columns: repeat(8, minmax(0, 1fr));
    width: 100%;
  }
  .station-grid.furnace {
    gap: 22px;
  }
  .station-cell {
    min-width: 0;
  }
  .station-cell > small {
    display: block;
    margin-bottom: 7px;
    text-align: center;
    font-size: 11px;
    color: #afa78e;
  }
  .craft-arrow {
    font-size: 36px;
    color: #c1ae83;
  }
  .result-wrap {
    display: flex;
    flex-direction: column;
    gap: 9px;
    align-items: center;
    width: 116px;
    color: #bcae8e;
    font-size: 11px;
  }
  .result-wrap .craft-result {
    position: relative;
    display: grid;
    place-items: center;
    width: 72px;
    height: 72px;
    padding: 10px;
    border: 2px solid #baa477;
    background: #26302a;
    border-radius: 3px;
    cursor: pointer;
  }
  .craft-result:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .craft-result:hover:enabled {
    background: #42553c;
    border-color: #e4d399;
  }
  .craft-result strong {
    position: absolute;
    bottom: 5px;
    right: 5px;
    font: 700 14px monospace;
  }
  .craft-result :global(.item-icon) {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: 56px;
    height: 56px;
    image-rendering: pixelated;
  }
  .smelting {
    display: flex;
    justify-content: center;
    gap: 18px;
    margin-top: 14px;
    color: #c3b28d;
    font-size: 11px;
  }
  .smelting progress {
    width: 90px;
    vertical-align: middle;
    accent-color: #d7a94c;
  }
  .station-recipe-book {
    margin-top: 14px;
    font-size: 12px;
  }
  summary {
    cursor: pointer;
    color: #dfccaa;
  }
  summary span {
    margin-left: 8px;
    color: #9c9989;
    font-size: 10px;
  }
  .station-recipes {
    display: flex;
    overflow-x: auto;
    gap: 12px;
    padding: 12px 0 4px;
  }
  article {
    flex: 0 0 130px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    border: 1px solid #77624370;
    padding: 8px;
  }
  article strong {
    font-size: 11px;
  }
  article small {
    font-size: 10px;
    color: #b2aa98;
  }
  .recipe-pattern {
    display: grid;
    grid-template-columns: repeat(3, 23px);
    gap: 2px;
  }
  .recipe-pattern span {
    width: 23px;
    height: 23px;
    background: #ffffff10;
  }
  .recipe-pattern :global(.item-icon) {
    width: 23px;
    height: 23px;
    image-rendering: pixelated;
  }
</style>

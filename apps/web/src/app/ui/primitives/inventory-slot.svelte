<script lang="ts">
  import ItemIcon from './item-icon.svelte';
  import type { GameplayItemPresentation } from '../gameplay-ui-projector';
  import type { InventoryUiSlot } from '../inventory-pointer-gestures';
  let {
    item,
    address,
    label,
    shortcut,
    active = false,
    preview,
    previewItem,
    onpress,
    onenter,
    onactivate,
  }: {
    item: GameplayItemPresentation;
    address: InventoryUiSlot;
    label?: string;
    shortcut?: number;
    active?: boolean;
    preview?: number;
    previewItem?: GameplayItemPresentation | null;
    onpress: (event: PointerEvent, address: InventoryUiSlot) => void;
    onenter: (address: InventoryUiSlot) => void;
    onactivate: (address: InventoryUiSlot) => void;
  } = $props();
  const shown = $derived(preview !== undefined && previewItem ? previewItem : item);
  const title = $derived(
    `${item.name}${item.count ? ` × ${item.count}` : ''}${item.durability ? ` · 耐久 ${item.durability.current}/${item.durability.max}` : ''}`,
  );
</script>

<button
  type="button"
  role="gridcell"
  class="item-slot"
  class:active
  class:previewing={preview !== undefined}
  aria-label={`${label ? `${label}：` : ''}${title}`}
  aria-selected={active}
  {title}
  data-slot={address.kind === 'inventory' ? address.slot : undefined}
  data-station-slot={address.kind === 'station' ? address.slot : undefined}
  data-inventory-address={`${address.kind}:${address.slot}`}
  data-item={item.itemId ?? 'empty'}
  data-count={item.count}
  onpointerdown={(event) => onpress(event, address)}
  onpointerenter={() => onenter(address)}
  onfocus={() => onenter(address)}
  oncontextmenu={(event) => event.preventDefault()}
  onclick={(event) => {
    if (event.detail === 0) onactivate(address);
  }}
>
  {#if shortcut}<small>{shortcut}</small>{/if}
  <ItemIcon itemId={shown.itemId} />
  {#if (preview ?? item.count) > 0}<strong>{preview ?? item.count}</strong>{/if}
  {#if item.durability}<span class="durability" aria-label={`耐久 ${item.durability.current}/${item.durability.max}`}
      ><i style:width={`${(100 * item.durability.current) / item.durability.max}%`}></i></span
    >{/if}
</button>

<style>
  .item-slot {
    position: relative;
    width: 100%;
    height: 58px;
    min-width: 0;
    padding: 7px;
    display: grid;
    place-items: center;
    color: #f0e5ce;
    background: #151e20;
    border: 1px solid #6b604a;
    border-radius: 3px;
    box-shadow:
      inset 2px 2px 0 #0007,
      inset -1px -1px 0 #c2ab7230;
    cursor: pointer;
    touch-action: none;
    user-select: none;
  }
  .item-slot:hover,
  .item-slot:focus-visible {
    background: #354340;
    border-color: #d6c393;
    outline: 1px solid #d6c393;
    outline-offset: -3px;
  }
  .item-slot.active {
    border-color: #c3a462;
  }
  .item-slot.previewing {
    background: #264a42;
    border-color: #a9e1c4;
  }
  .item-slot :global(.item-icon) {
    width: 34px;
    height: 34px;
    image-rendering: pixelated;
    pointer-events: none;
    -webkit-user-drag: none;
  }
  strong {
    position: absolute;
    right: 5px;
    bottom: 5px;
    font: 700 13px/1 monospace;
    text-shadow: 1px 2px 0 #000;
    pointer-events: none;
  }
  small {
    position: absolute;
    left: 5px;
    top: 4px;
    color: #b7a784;
    font-size: 9px;
    pointer-events: none;
  }
  .durability {
    position: absolute;
    bottom: 3px;
    left: 7px;
    right: 7px;
    height: 3px;
    background: #000;
    pointer-events: none;
  }
  .durability i {
    display: block;
    height: 100%;
    background: #89c37e;
  }
  @media (max-width: 720px) {
    .item-slot {
      height: 48px;
      padding: 3px;
    }
    .item-slot :global(.item-icon) {
      width: 28px;
      height: 28px;
    }
  }
</style>

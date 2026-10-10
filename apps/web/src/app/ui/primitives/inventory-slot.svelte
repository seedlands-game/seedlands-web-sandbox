<script lang="ts">
  import ItemIcon from './item-icon.svelte';
  import type { EquipmentItemPresentation, GameplayItemPresentation } from '../gameplay-ui-projector';
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
    item: GameplayItemPresentation | EquipmentItemPresentation;
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
  data-crafting-slot={address.kind === 'crafting' ? address.slot : undefined}
  data-station-slot={address.kind === 'station' ? address.slot : undefined}
  data-equipment-slot={address.kind === 'equipment' ? address.slot : undefined}
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
    height: var(--classic-slot-size);
    min-width: 0;
    overflow: hidden;
    padding: 0;
    display: grid;
    place-items: center;
    color: #f0e5ce;
    background: var(--classic-slot-surface);
    border: var(--classic-slot-border);
    border-radius: 0;
    box-shadow: inset 1px 1px 0 #626262;
    cursor: pointer;
    touch-action: none;
    user-select: none;
  }
  .item-slot:hover,
  .item-slot:focus-visible {
    background: var(--classic-slot-hover-surface);
    border-color: #c8c8c8;
    outline: 0;
  }
  .item-slot.active {
    outline: 2px solid var(--classic-slot-selected);
    outline-offset: -2px;
  }
  .item-slot.previewing {
    background: #264a42;
    border-color: #a9e1c4;
  }
  .item-slot :global(.item-icon) {
    position: absolute;
    inset: var(--classic-slot-icon-inset);
    width: calc(100% - var(--classic-slot-icon-inset) - var(--classic-slot-icon-inset));
    height: calc(100% - var(--classic-slot-icon-inset) - var(--classic-slot-icon-inset));
    max-width: calc(100% - var(--classic-slot-icon-inset) - var(--classic-slot-icon-inset));
    max-height: calc(100% - var(--classic-slot-icon-inset) - var(--classic-slot-icon-inset));
    object-fit: contain;
    transform: none;
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
</style>

<script lang="ts">
  import ItemIcon from './item-icon.svelte';
  let {
    label,
    selected,
    keyLabel,
    name,
    itemId,
    count = 0,
    durability,
    onclick,
  }: {
    label: string;
    selected: boolean;
    keyLabel: string;
    name: string;
    itemId: string | null;
    count?: number;
    durability?: Readonly<{ current: number; max: number }>;
    onclick: () => void;
  } = $props();
</script>

<button
  type="button"
  class:active={selected}
  class="game-slot slot"
  aria-label={label}
  aria-pressed={selected}
  data-item={itemId ?? 'empty'}
  {onclick}
>
  <span class="slot-key">{keyLabel}</span>
  <span class="slot-swatch" aria-hidden="true"><ItemIcon {itemId} /></span>
  <span class="slot-name">{name}</span>
  {#if count > 1}<span class="slot-count">{count}</span>{/if}
  {#if durability}<small class="slot-durability" aria-label={`耐久 ${durability.current}/${durability.max}`}
      >{durability.current}/{durability.max}</small
    >{/if}
</button>

<style>
  .slot-durability {
    position: absolute;
    bottom: 1px;
    left: 4px;
    font-size: 9px;
    line-height: 11px;
    color: #b3e4c0;
  }
</style>

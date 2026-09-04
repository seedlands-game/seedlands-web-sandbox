<script lang="ts">
  let {
    label,
    selected,
    keyLabel,
    name,
    itemId,
    count = 0,
    onclick,
  }: {
    label: string;
    selected: boolean;
    keyLabel: string;
    name: string;
    itemId: string | null;
    count?: number;
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
  <span class="slot-swatch" aria-hidden="true">{itemId ? name.slice(0, 1) : ''}</span>
  <span class="slot-name">{name}</span>
  {#if count > 1}<span class="slot-count">{count}</span>{/if}
</button>

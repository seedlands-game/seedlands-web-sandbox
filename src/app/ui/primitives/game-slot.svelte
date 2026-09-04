<script lang="ts">
  let {
    label,
    selected,
    keyLabel,
    name,
    tileX,
    tileY,
    onclick,
  }: {
    label: string;
    selected: boolean;
    keyLabel: string;
    name: string;
    tileX: number;
    tileY: number;
    onclick: () => void;
  } = $props();
</script>

<button
  type="button"
  class:active={selected}
  class="game-slot slot"
  aria-label={label}
  aria-pressed={selected}
  data-material={name}
  {onclick}
>
  <span class="slot-key">{keyLabel}</span>
  <span class="slot-swatch" style={`--tile-x:${tileX};--tile-y:${tileY}`}></span>
  <span class="slot-name">{name}</span>
</button>

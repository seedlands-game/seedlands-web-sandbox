<script lang="ts">
  import type { HudState } from './ui-contracts';
  import GameSlot from './primitives/game-slot.svelte';

  let {
    slots,
    selected,
    onselect,
  }: { slots: HudState['hotbar']; selected: number; onselect: (material: number) => void } = $props();
</script>

<div id="hotbar" role="list" aria-label="材质快捷栏">
  {#each slots as slot, index (slot.id)}
    <GameSlot
      label={`选择${slot.name}`}
      selected={selected === slot.id}
      keyLabel={String(index + 1)}
      name={slot.name}
      tileX={slot.tile[0]}
      tileY={slot.tile[1]}
      onclick={() => onselect(slot.id)}
    />
  {/each}
</div>

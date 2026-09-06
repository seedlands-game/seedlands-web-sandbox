<script lang="ts">
  import type { HudState } from './ui-contracts';
  import GameSlot from './primitives/game-slot.svelte';

  let { slots, selected, onselect }: { slots: HudState['hotbar']; selected: number; onselect: (slot: number) => void } =
    $props();
</script>

<ol id="hotbar" aria-label="快捷栏">
  {#each slots as slot (slot.slot)}
    <li>
      <GameSlot
        label={`选择${slot.name}${slot.count ? ` ${slot.count}` : ''}`}
        selected={selected === slot.slot}
        keyLabel={String(slot.slot + 1)}
        name={slot.name}
        itemId={slot.itemId}
        count={slot.count}
        onclick={() => onselect(slot.slot)}
      />
    </li>
  {/each}
</ol>

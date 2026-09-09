<script lang="ts">
  import type { ActorMode, HudState } from './ui-contracts';
  import GameSlot from './primitives/game-slot.svelte';

  let {
    slots,
    selected,
    mode,
    onselect,
  }: { slots: HudState['hotbar']; selected: number; mode: ActorMode; onselect: (slot: number) => void } = $props();
</script>

<ol id="hotbar" aria-label={mode === 'creative' ? '创造快捷栏' : '生存快捷栏'}>
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

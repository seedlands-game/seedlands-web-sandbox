<script lang="ts">
  import type { HudState, InteractionState } from './ui-contracts';
  let { hud, interaction }: { hud: HudState; interaction: InteractionState } = $props();
  const held = $derived(hud.hotbar[hud.selectedHotbarSlot]);
  let activeGesture = $state<string | null>(null);
  const gesture = $derived(interaction.gesture);
  $effect(() => {
    activeGesture = gesture?.kind ?? null;
    const timer = setTimeout(() => (activeGesture = null), 420);
    return () => clearTimeout(timer);
  });
  const action = $derived(activeGesture ?? (interaction.breaking ? 'mining' : 'idle'));
</script>

<div
  id="player-action"
  class="sr-only"
  role="img"
  aria-label={`手持 ${held?.itemId ? held.name : '空手'}`}
  data-action={action}
></div>
<div class:visible={activeGesture === 'damage'} class="damage-edge" aria-hidden="true"></div>

<style>
  .damage-edge {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 3;
    opacity: 0;
    background: radial-gradient(ellipse at center, transparent 48%, #9d351580);
    transition: opacity 180ms ease-out;
  }
  .damage-edge.visible {
    opacity: 1;
  }
  @media (prefers-reduced-motion: reduce) {
    .damage-edge {
      transition: none;
    }
  }
</style>

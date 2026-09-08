<script lang="ts">
  import type { HudState, InteractionState } from './ui-contracts';
  let { hud, interaction }: { hud: HudState; interaction: InteractionState } = $props();
  const held = $derived(hud.hotbar[hud.selectedHotbarSlot]);
  let activeGesture = $state<string | null>(null);
  const gesture = $derived(interaction.gesture);
  const damageAmount = $derived(gesture?.kind === 'damage' ? gesture.amount : undefined);
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
<div id="player-damage-feedback" class:visible={activeGesture === 'damage'} role="status" aria-label="玩家受击反馈">
  受击{damageAmount ? ` -${damageAmount}` : ''}
</div>

<style>
  .damage-edge {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 3;
    opacity: 0;
    background:
      linear-gradient(90deg, #c51f1738 0 5%, transparent 12% 88%, #c51f1738 95% 100%),
      radial-gradient(ellipse at center, transparent 42%, #e4382c88 78%, #8e1511bb 100%);
    mix-blend-mode: screen;
    transition: opacity 180ms ease-out;
  }
  .damage-edge.visible {
    opacity: 1;
  }
  #player-damage-feedback {
    position: fixed;
    left: 50%;
    top: calc(50% - 86px);
    z-index: 4;
    color: #ffb0a8;
    font:
      700 19px/1 Georgia,
      'Songti SC',
      serif;
    letter-spacing: 0.08em;
    text-shadow:
      0 2px 2px #4c0606,
      0 0 12px #ff2b1a;
    opacity: 0;
    transform: translate(-50%, 10px) scale(0.92);
    transition:
      opacity 90ms ease-out,
      transform 160ms ease-out;
    pointer-events: none;
  }
  #player-damage-feedback.visible {
    opacity: 1;
    transform: translate(-50%, 0) scale(1);
  }
  @media (prefers-reduced-motion: reduce) {
    .damage-edge {
      transition: none;
    }
  }
</style>

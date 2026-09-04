<script lang="ts">
  import type { HudState, InteractionState } from './ui-contracts';
  import ItemIcon from './primitives/item-icon.svelte';
  let { hud, interaction }: { hud: HudState; interaction: InteractionState } = $props();
  const held = $derived(hud.hotbar[hud.selectedHotbarSlot]);
  let activeGesture = $state<string | null>(null);
  $effect(() => {
    activeGesture = interaction.gesture?.kind ?? null;
    const timer = setTimeout(() => (activeGesture = null), 420);
    return () => clearTimeout(timer);
  });
  const action = $derived(activeGesture ?? (interaction.breaking ? 'mining' : 'idle'));
</script>

<div class="player-action" role="img" aria-label={`手持 ${held?.itemId ? held.name : '空手'}`} data-action={action}>
  <div class="held-hand">
    {#if held?.itemId}<div class="held-object"><ItemIcon itemId={held.itemId} /></div>{/if}
    <svg class="gloved-hand" viewBox="0 0 220 260" aria-hidden="true">
      <path
        d="M87 87 72 57Q69 46 81 41L109 29Q121 25 126 37L141 67 155 86 155 135 111 153 82 119Z"
        fill="#94724e"
        stroke="#3c3026"
        stroke-width="4"
      />
      <path
        d="M111 56 135 44Q149 42 152 55L163 101 149 125 128 111Z"
        fill="#a7875d"
        stroke="#3c3026"
        stroke-width="4"
      />
      <path d="M84 113 151 100 204 251 77 260Z" fill="#263b3b" stroke="#101d20" stroke-width="5" />
      <path d="M83 121 152 108 157 125 84 140Z" fill="#67533a" stroke="#b49a60" stroke-width="3" />
      <path d="M109 147 144 140 177 243 113 252Z" fill="#31494a" />
      <path d="M94 149 99 247M151 145 180 239" stroke="#738079" stroke-width="2" stroke-dasharray="4 7" />
    </svg>
  </div>
</div>
<div class:visible={activeGesture === 'damage'} class="damage-edge" aria-hidden="true"></div>

<style>
  .player-action {
    position: fixed;
    right: max(5vw, 18px);
    bottom: 60px;
    width: 220px;
    height: 260px;
    pointer-events: none;
    z-index: 2;
    filter: drop-shadow(3px 8px 8px #0005);
  }
  .held-hand {
    position: relative;
    width: 100%;
    height: 100%;
    transform: rotate(-14deg) translateY(55px);
    transform-origin: 65% 100%;
  }
  .gloved-hand {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  .held-object {
    position: absolute;
    z-index: 1;
    left: 36px;
    top: -10px;
    transform: rotate(-18deg);
  }
  .held-object :global(.item-icon) {
    width: 110px;
    height: 110px;
  }
  [data-action='mining'] .held-hand {
    animation: hand-mine 620ms ease-in-out infinite;
  }
  [data-action='attack'] .held-hand,
  [data-action='place'] .held-hand {
    animation: hand-use 380ms ease-out;
  }
  [data-action='eat'] .held-hand {
    animation: hand-eat 420ms ease-in-out;
  }
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
  @keyframes hand-mine {
    0%,
    100% {
      transform: rotate(-14deg) translateY(55px);
    }
    45% {
      transform: rotate(-40deg) translate(-26px, 24px);
    }
  }
  @keyframes hand-use {
    35% {
      transform: rotate(-48deg) translate(-35px, 22px);
    }
  }
  @keyframes hand-eat {
    50% {
      transform: rotate(-27deg) translate(-50px, -32px);
    }
  }
  @media (max-width: 720px) {
    .player-action {
      right: 5px;
      bottom: 80px;
      width: 150px;
      height: 180px;
    }
    .held-object :global(.item-icon) {
      width: 75px;
      height: 75px;
    }
    .held-object {
      left: 26px;
      top: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .held-hand {
      animation: none !important;
    }
    .damage-edge {
      transition: none;
    }
  }
</style>

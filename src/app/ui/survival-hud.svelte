<script lang="ts">
  import type { HudState, InteractionState } from './ui-contracts';

  let { hud, interaction }: { hud: HudState; interaction: InteractionState } = $props();
</script>

<section id="survival-vitals" class="game-panel" aria-label="生存状态">
  <label>
    <span>生命</span>
    <meter aria-label="生命" aria-valuenow={hud.health.value} min="0" max={hud.health.max} value={hud.health.value}
    ></meter>
    <strong>{hud.health.value}</strong>
  </label>
  <label>
    <span>饥饿</span>
    <meter aria-label="饥饿" aria-valuenow={hud.hunger.value} min="0" max={hud.hunger.max} value={hud.hunger.value}
    ></meter>
    <strong>{hud.hunger.value}</strong>
  </label>
</section>

{#if interaction.breaking}
  <div id="break-progress" class="game-panel" aria-label={`正在采集${interaction.breaking.label}`}>
    <span>{interaction.breaking.label}</span>
    <progress aria-label="采集进度" max="1" value={interaction.breaking.progress}></progress>
  </div>
{/if}

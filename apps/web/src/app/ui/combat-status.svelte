<script lang="ts">
  import type { CombatUiProjection } from './combat-ui-projector';
  let { combat }: { combat: CombatUiProjection | undefined } = $props();
</script>

{#if combat}
  <div id="combat-status" data-phase={combat.phase} aria-label="战斗节奏" class:ready={combat.phase === 'ready'}>
    <div class="combat-label">
      <span>{combat.label}{combat.comboStep > 0 ? ` · 第 ${combat.comboStep + 1} 击` : ''}</span>
      {#if combat.remainingSeconds > 0}<span class="combat-time">{combat.remainingSeconds.toFixed(1)}s</span>{/if}
    </div>
    <progress aria-label="攻击阶段进度" max="1" value={combat.progress}></progress>
    <small>{combat.hint}</small>
  </div>
{/if}

<style>
  #combat-status {
    position: absolute;
    left: 50%;
    top: calc(50% + 42px);
    transform: translateX(-50%);
    width: 180px;
    color: #f4d6a1;
    text-shadow: 0 1px 3px #000;
    font-size: 12px;
    pointer-events: none;
    opacity: 0.95;
  }
  .combat-label {
    display: flex;
    justify-content: space-between;
    gap: 12px;
  }
  .combat-time {
    font-variant-numeric: tabular-nums;
  }
  progress {
    display: block;
    width: 100%;
    height: 3px;
    margin: 6px 0;
    accent-color: #d9ad61;
  }
  small {
    display: block;
    text-align: center;
    font-size: 10px;
    color: #d2cbc0;
  }
  .ready {
    opacity: 0.65;
  }
  .ready .combat-label {
    justify-content: center;
    color: #b9d6ce;
  }
  .ready progress {
    opacity: 0.45;
  }
  @media (max-height: 500px) {
    #combat-status {
      top: calc(50% + 24px);
    }
    small {
      display: none;
    }
  }
</style>

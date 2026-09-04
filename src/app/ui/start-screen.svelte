<script lang="ts">
  import type { QualityLevel } from '../quality-profile';
  import type { ShellState } from './ui-contracts';
  import GameButton from './primitives/game-button.svelte';
  import GamePanel from './primitives/game-panel.svelte';
  import GameTextField from './primitives/game-text-field.svelte';

  let { shell, onstart }: { shell: ShellState; onstart: (seed: string, quality: QualityLevel) => void } = $props();
  let seed = $state('');
  let quality = $state<QualityLevel>('medium');
  let initialized = false;
  let previousPhase: ShellState['phase'] = 'boot';

  $effect(() => {
    if (!initialized || shell.phase === 'error' || (previousPhase === 'boot' && !seed)) {
      seed = shell.seed;
      quality = shell.quality;
      initialized = true;
    }
    previousPhase = shell.phase;
  });
</script>

<GamePanel id="start-card" class="start-card" role="region" hidden={shell.phase === 'playing'}>
  <p class="eyebrow">PROCEDURAL FANTASY WORLD</p>
  <h1>Seedlands</h1>
  <p>走进一个由 Seed 苏醒、会随脚步延展的体素秘境。</p>
  <div class="world-tags" aria-hidden="true"><span>草原</span><span>森林</span><span>山脉</span><span>河湖</span></div>
  <div class="start-fields">
    <GameTextField id="seed" label="世界 Seed" bind:value={seed} maxlength={48} placeholder="留空创建随机世界" />
    <label for="quality">
      视觉质量
      <select id="quality" bind:value={quality} disabled={shell.phase === 'boot' || shell.phase === 'loading'}>
        <option value="low">Low · 省电</option>
        <option value="medium">Medium · 均衡</option>
        <option value="high">High · 远景</option>
      </select>
    </label>
  </div>
  <GameButton
    label={shell.enterLabel}
    disabled={shell.phase === 'boot' || shell.phase === 'loading'}
    onclick={() => onstart(seed, quality)}
  >
    {shell.enterLabel}
  </GameButton>
  {#if shell.phase === 'error'}<p class="start-error" role="alert">世界启动失败，请重试。</p>{/if}
  <small>同一 Seed + 生成器版本会得到同一基础世界</small>
</GamePanel>

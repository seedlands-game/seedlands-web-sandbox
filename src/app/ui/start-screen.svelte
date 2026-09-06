<script lang="ts">
  import { onMount } from 'svelte';
  import type { ApplicationShell } from '../application-shell';
  import type { QualityLevel } from '../scene/quality-profile';
  import type { ShellState } from './ui-contracts';
  import GameButton from './primitives/game-button.svelte';
  import GamePanel from './primitives/game-panel.svelte';
  import GameTextField from './primitives/game-text-field.svelte';
  import SeedlandsMark from './primitives/seedlands-mark.svelte';
  import type { WorldOpenMode } from '../../client/world-version-policy';

  let {
    shell,
    application,
    onstart,
  }: {
    shell: ShellState;
    application: ApplicationShell;
    onstart: (seed: string, quality: QualityLevel, openMode: WorldOpenMode) => void;
  } = $props();
  let latestSeed = $state('');
  let error = $state('');
  onMount(() =>
    application.subscribe(() => {
      latestSeed = application.latestSeed;
      quality = application.quality;
      error = application.controller.state.error;
    }),
  );
  let seed = $state('');
  let quality = $state<QualityLevel>('medium');
  let openMode = $state<WorldOpenMode>('continue');
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
  <SeedlandsMark />
  <p class="eyebrow">PROCEDURAL FANTASY WORLD</p>
  <h1>Seedlands</h1>
  <p>走进一个由 Seed 苏醒、会随脚步延展的体素秘境。</p>
  <div class="world-tags" aria-hidden="true"><span>草原</span><span>森林</span><span>山脉</span><span>河湖</span></div>
  {#if latestSeed && shell.phase !== 'loading'}
    <GameButton class="continue-world" label="继续世界" onclick={() => void application.continueWorld()}
      >继续世界 <small>{latestSeed}</small></GameButton
    >
  {/if}
  <div class="start-fields">
    <GameTextField id="seed" label="世界 Seed" bind:value={seed} maxlength={48} placeholder="留空创建随机世界" />
    <label for="quality">
      视觉质量
      <select id="quality" bind:value={quality} disabled={shell.phase === 'boot' || shell.phase === 'loading'}>
        <option value="low">Low · 省电</option>
        <option value="medium">Medium · 均衡</option>
        <option value="high">High · 精致</option>
      </select>
    </label>
  </div>
  <label class="world-version-choice" for="world-version-mode">
    世界版本
    <select id="world-version-mode" bind:value={openMode} disabled={shell.phase === 'loading'}>
      <option value="continue">默认继续（优先已有新版）</option>
      <option value="continue-legacy">明确继续旧版 v2</option>
      <option value="new-current">新建或进入新版 v3（保留旧档）</option>
    </select>
  </label>
  <GameButton
    class="recommended-start"
    label="推荐起点：林间河岸"
    disabled={shell.phase === 'boot' || shell.phase === 'loading'}
    onclick={() => (seed = 'mosslight-68')}>推荐起点：林间河岸 <small>森林 · 河水 · 营地</small></GameButton
  >
  <GameButton
    label={shell.enterLabel}
    disabled={shell.phase === 'boot' || shell.phase === 'loading'}
    onclick={() => onstart(seed, quality, openMode)}
  >
    {shell.enterLabel}
  </GameButton>
  <div class="menu-secondary">
    <GameButton label="设置" disabled={shell.phase === 'loading'} onclick={() => application.openPanel('settings')}
      >设置</GameButton
    >
    <GameButton label="操作指南" disabled={shell.phase === 'loading'} onclick={() => application.openPanel('guide')}
      >操作指南</GameButton
    >
  </div>
  {#if error}<p class="start-error" role="alert">{error}</p>{/if}
  <small>旧版河岸不会自动改变；版本选择可继续 v2，也可为同名 Seed 保留旧档并进入 v3。</small>
</GamePanel>

<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { ApplicationShell } from '../application-shell';
  import type { QualityLevel } from '../scene/quality-profile';
  import type { ActorMode, ShellState } from './ui-contracts';
  import GameButton from './primitives/game-button.svelte';
  import GamePanel from './primitives/game-panel.svelte';
  import GameTextField from './primitives/game-text-field.svelte';
  import SeedlandsMark from './primitives/seedlands-mark.svelte';
  import { GENERATOR_VERSION } from '@seedlands/game-core/world/voxel';
  import type { WorldOpenMode } from '@seedlands/game-core/runtime/world-version-policy';
  import type { WorkerSupport } from '../client-capability-preflight';
  import WorldLoading from './world-loading.svelte';

  let {
    shell,
    application,
    assetBase,
    onstart,
    onstartshowcase,
  }: {
    shell: ShellState;
    application: ApplicationShell | null;
    assetBase: string;
    onstart: (seed: string, quality: QualityLevel, openMode: WorldOpenMode, actorMode: ActorMode) => void;
    onstartshowcase: (quality: QualityLevel) => void;
  } = $props();
  let latestSeed = $state('');
  let error = $state('');
  let workerSupport = $state<WorkerSupport>('checking');
  onMount(() =>
    application?.subscribe(() => {
      latestSeed = application.latestSeed;
      error = application.controller.state.error;
      workerSupport = application.capabilities.workerSupport;
    }),
  );
  let seed = $state(untrack(() => shell.seed));
  let quality = $state<QualityLevel>(untrack(() => shell.quality));
  let openMode = $state<WorldOpenMode>('continue');
  let actorMode = $state<ActorMode>('survival');
  let previousPhase: ShellState['phase'] = untrack(() => shell.phase);
  let seedTouched = $state(untrack(() => Boolean(shell.seed)));
  let qualityTouched = $state(untrack(() => shell.quality !== 'medium'));

  $effect(() => {
    if (previousPhase === 'boot' && shell.phase !== 'boot' && shell.phase !== 'error') {
      if (!seedTouched) seed = shell.seed;
      if (!qualityTouched) quality = shell.quality;
    }
    previousPhase = shell.phase;
  });
</script>

<GamePanel id="start-card" class="start-card" role="region" hidden={shell.phase === 'playing'}>
  {#if shell.phase === 'loading'}
    <WorldLoading />
  {:else}
    <SeedlandsMark {assetBase} />
    <p class="eyebrow">PROCEDURAL FANTASY WORLD</p>
    <h1>Seedlands</h1>
    <p>走进一个由 Seed 苏醒、会随脚步延展的体素秘境。</p>
    <div class="world-tags" aria-hidden="true">
      <span>草原</span><span>森林</span><span>山脉</span><span>河湖</span>
    </div>
    {#if latestSeed && !shell.initializationError}
      <GameButton
        class="continue-world"
        label="继续世界"
        disabled={workerSupport !== 'supported'}
        onclick={() => void application?.continueWorld()}>继续世界 <small>{latestSeed}</small></GameButton
      >
    {/if}
    <div class="start-fields">
      <GameTextField
        id="seed"
        label="世界 Seed"
        bind:value={seed}
        maxlength={48}
        placeholder="留空创建随机世界"
        oninput={() => (seedTouched = true)}
      />
      <label for="quality">
        视觉质量
        <select id="quality" bind:value={quality} onchange={() => (qualityTouched = true)}>
          <option value="low">Low · 省电</option>
          <option value="medium">Medium · 均衡</option>
          <option value="high">High · 精致</option>
        </select>
      </label>
    </div>
    <label class="world-version-choice" for="world-version-mode">
      世界版本
      <select id="world-version-mode" bind:value={openMode}>
        <option value="continue">默认继续（优先已有新版）</option>
        <option value="continue-v2">明确继续旧版 v2</option>
        <option value="continue-v3">明确继续旧版 v3</option>
        <option value="new-current">新建或进入新版 v{GENERATOR_VERSION}（保留旧档）</option>
      </select>
    </label>
    <label class="world-version-choice" for="actor-mode">
      新世界模式
      <select id="actor-mode" bind:value={actorMode}>
        <option value="survival">生存 · 采集、合成与资源消耗</option>
        <option value="creative">创造 · 内容目录、飞行与即时编辑</option>
      </select>
      <small>只作用于首次创建；继续已有世界时保留存档模式。</small>
    </label>
    {#if shell.initializationError}
      <GameButton id="enter" label={shell.enterLabel} onclick={() => application?.reloadAfterInitializationFailure()}>
        {shell.enterLabel}
      </GameButton>
    {:else}
      <GameButton
        class="recommended-start"
        label="推荐起点：林间河岸"
        disabled={shell.phase === 'boot' || workerSupport !== 'supported'}
        onclick={() => {
          seedTouched = true;
          seed = 'mosslight-68';
        }}>推荐起点：林间河岸 <small>森林 · 河水 · 营地</small></GameButton
      >
      <GameButton
        id="enter"
        label={shell.enterLabel}
        disabled={shell.phase === 'boot' || workerSupport !== 'supported'}
        onclick={() => onstart(seed, quality, openMode, actorMode)}
      >
        {shell.enterLabel}
      </GameButton>
      <GameButton
        class="melee-showcase-start"
        label="木剑动作体验场"
        disabled={shell.phase === 'boot' || workerSupport !== 'supported'}
        onclick={() => onstartshowcase(quality)}
        >木剑动作体验场 <small>木剑已装备 · 两段斜劈 · 玩家受击反馈</small></GameButton
      >
    {/if}
    <div class="menu-secondary">
      <GameButton label="设置" onclick={() => application?.openPanel('settings')}>设置</GameButton>
      <GameButton label="操作指南" onclick={() => application?.openPanel('guide')}>操作指南</GameButton>
    </div>
    {#if shell.initializationError}
      <p class="start-error" role="alert">{shell.initializationError}</p>
    {:else if error}
      <p class="start-error" role="alert">{error}</p>
    {/if}
    {#if workerSupport === 'unsupported'}
      <p class="start-error" role="alert">当前浏览器不支持运行游戏所需的 Web Worker，无法进入世界。</p>
    {/if}
    <small>旧版世界不会自动改变；可明确继续 v2 / v3，或保留旧档并进入同名 Seed 的 v{GENERATOR_VERSION} 世界。</small>
  {/if}
</GamePanel>

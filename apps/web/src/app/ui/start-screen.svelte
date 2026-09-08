<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { ApplicationShell } from '../application-shell';
  import type { QualityLevel } from '../scene/quality-profile';
  import type { ShellState } from './ui-contracts';
  import GameButton from './primitives/game-button.svelte';
  import GamePanel from './primitives/game-panel.svelte';
  import GameTextField from './primitives/game-text-field.svelte';
  import SeedlandsMark from './primitives/seedlands-mark.svelte';
  import type { WorldOpenMode } from '@seedlands/game-core/runtime/world-version-policy';
  import type { WorkerSupport } from '../client-capability-preflight';
  import WorldLoading from './world-loading.svelte';

  let {
    shell,
    application,
    assetBase,
    onstart,
  }: {
    shell: ShellState;
    application: ApplicationShell | null;
    assetBase: string;
    onstart: (seed: string, quality: QualityLevel, openMode: WorldOpenMode) => void;
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
  let connectionMode = $state<'local' | 'remote'>('local');
  let nodeUrl = $state('ws://127.0.0.1:8787/seedlands');
  let nodeAccessKey = $state('');
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
  const connectRemote = () => {
    const accessKey = nodeAccessKey;
    nodeAccessKey = '';
    void application?.connectRemote(nodeUrl, accessKey, quality);
  };
</script>

<GamePanel id="start-card" class="start-card" role="region" hidden={shell.phase === 'playing'}>
  {#if shell.phase === 'loading'}
    <WorldLoading />
    {#if application?.controller.state.mode === 'remote'}
      <GameButton label="取消连接" onclick={() => application.controller.cancelStart()}>取消连接</GameButton>
    {/if}
  {:else}
    <SeedlandsMark {assetBase} />
    <p class="eyebrow">PROCEDURAL FANTASY WORLD</p>
    <h1>Seedlands</h1>
    <p>走进一个由 Seed 苏醒、会随脚步延展的体素秘境。</p>
    <div class="world-tags" aria-hidden="true">
      <span>草原</span><span>森林</span><span>山脉</span><span>河湖</span>
    </div>
    <label for="connection-mode">
      世界来源
      <select id="connection-mode" bind:value={connectionMode}>
        <option value="local">此浏览器</option>
        <option value="remote">本机 Node</option>
      </select>
    </label>
    {#if connectionMode === 'local' && latestSeed && !shell.initializationError}
      <GameButton
        class="continue-world"
        label="继续世界"
        disabled={workerSupport !== 'supported'}
        onclick={() => void application?.continueWorld()}>继续世界 <small>{latestSeed}</small></GameButton
      >
    {/if}
    <div class="start-fields">
      {#if connectionMode === 'local'}<GameTextField
          id="seed"
          label="世界 Seed"
          bind:value={seed}
          maxlength={48}
          placeholder="留空创建随机世界"
          oninput={() => (seedTouched = true)}
        />{:else}
        <GameTextField id="node-url" label="Node 地址" bind:value={nodeUrl} maxlength={128} />
        <GameTextField
          id="node-access-key"
          label="访问口令"
          type="password"
          bind:value={nodeAccessKey}
          maxlength={256}
          placeholder="只用于本次连接"
        />
      {/if}
      <label for="quality">
        视觉质量
        <select id="quality" bind:value={quality} onchange={() => (qualityTouched = true)}>
          <option value="low">Low · 省电</option>
          <option value="medium">Medium · 均衡</option>
          <option value="high">High · 精致</option>
        </select>
      </label>
    </div>
    {#if connectionMode === 'local'}<label class="world-version-choice" for="world-version-mode">
        世界版本
        <select id="world-version-mode" bind:value={openMode}>
          <option value="continue">默认继续（优先已有新版）</option>
          <option value="continue-legacy">明确继续旧版 v2</option>
          <option value="new-current">新建或进入新版 v3（保留旧档）</option>
        </select>
      </label>{:else}<p class="muted">只允许本机 ws 地址；世界权威、持续 tick 与存档都由 Node 持有。</p>{/if}
    {#if shell.initializationError}
      <GameButton id="enter" label={shell.enterLabel} onclick={() => application?.reloadAfterInitializationFailure()}>
        {shell.enterLabel}
      </GameButton>
    {:else}
      {#if connectionMode === 'local'}<GameButton
          class="recommended-start"
          label="推荐起点：林间河岸"
          disabled={shell.phase === 'boot' || workerSupport !== 'supported'}
          onclick={() => {
            seedTouched = true;
            seed = 'mosslight-68';
          }}>推荐起点：林间河岸 <small>森林 · 河水 · 营地</small></GameButton
        >
      {/if}
      <GameButton
        id="enter"
        label={connectionMode === 'remote' ? '连接本机 Node' : shell.enterLabel}
        disabled={shell.phase === 'boot' ||
          workerSupport !== 'supported' ||
          (connectionMode === 'remote' && !nodeAccessKey)}
        onclick={() => (connectionMode === 'remote' ? connectRemote() : onstart(seed, quality, openMode))}
      >
        {connectionMode === 'remote' ? '连接本机 Node' : shell.enterLabel}
      </GameButton>
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
    {#if connectionMode === 'local'}<small
        >旧版河岸不会自动改变；版本选择可继续 v2，也可为同名 Seed 保留旧档并进入 v3。</small
      >{/if}
  {/if}
</GamePanel>

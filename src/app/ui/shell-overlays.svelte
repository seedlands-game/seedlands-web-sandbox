<script lang="ts">
  import { publicAssetUrl } from '../../client/presentation/public-asset-url';
  import { onMount } from 'svelte';
  import type { ApplicationShell } from '../application-shell';
  import type { AudioSettings } from '../../client/audio/audio-types';
  import type { ShellQuality } from '../../client/shell/shell-controller';
  import GamePanel from './primitives/game-panel.svelte';
  import GameButton from './primitives/game-button.svelte';
  import { modalFocus } from './modal-focus';

  let { application }: { application: ApplicationShell } = $props();
  const initial = () => ({
    state: application.controller.state,
    panel: application.panel,
    quality: application.quality,
    experiments: application.pendingExperiments,
    appliedExperiments: application.appliedExperiments,
    experimentsRequireRefresh: application.experimentsRequireRefresh,
    capabilities: application.capabilities,
    performanceWarningOpen: application.performanceWarningOpen,
  });
  let view = $state(initial());
  const readAudio = () => application.audio.snapshot();
  let audio = $state(readAudio());
  const buses: { key: keyof AudioSettings; label: string }[] = [
    { key: 'master', label: '总音量' },
    { key: 'music', label: '音乐音量' },
    { key: 'sfx', label: '音效音量' },
    { key: 'ambience', label: '环境音量' },
  ];
  onMount(() => {
    const unsubscribeShell = application.subscribe(() => {
      view = initial();
    });
    const unsubscribeAudio = application.audio.subscribe(() => {
      audio = application.audio.snapshot();
    });
    return () => {
      unsubscribeShell();
      unsubscribeAudio();
    };
  });
  const chooseFile = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (file) await application.audio.importReference(file);
    input.value = '';
  };
</script>

{#if view.state.phase === 'playing'}
  <GameButton
    id="pause-toggle"
    class="game-panel pause-toggle"
    label="暂停游戏"
    onclick={() => application.controller.pause()}>暂停 · Esc</GameButton
  >
{/if}

{#if view.panel || view.state.phase === 'paused' || view.state.phase === 'saving' || view.performanceWarningOpen}
  <div
    class="shell-scrim"
    use:modalFocus={() =>
      view.performanceWarningOpen
        ? application.cancelPerformanceWarning()
        : view.panel
          ? application.closePanel()
          : application.controller.resume()}
  >
    <GamePanel
      class="shell-dialog"
      kind={view.performanceWarningOpen ? 'warning' : (view.panel ?? 'pause')}
      role="dialog"
      label={view.performanceWarningOpen
        ? '性能提示'
        : view.panel === 'settings'
          ? '设置'
          : view.panel === 'guide'
            ? '操作指南'
            : '暂停游戏'}
    >
      <img class="menu-crest" src={publicAssetUrl(import.meta.env.BASE_URL, 'assets/ui/arcane-crest.png')} alt="" />
      {#if view.performanceWarningOpen}
        <p class="eyebrow">PERFORMANCE NOTICE</p>
        <h2>性能提示</h2>
        <p role="alert">
          当前浏览器估算可用 {view.capabilities.estimatedCores} 个核心，低于游戏需要的 {view.capabilities
            .requiredWorkerCount}
          个 Worker，加载或游玩时可能出现卡顿。
        </p>
        <div class="menu-secondary">
          <GameButton label="取消进入" onclick={() => application.cancelPerformanceWarning()}>取消</GameButton>
          <GameButton label="仍然进入" onclick={() => void application.confirmPerformanceWarning()}>仍然进入</GameButton
          >
        </div>
      {:else if view.panel === 'settings'}
        <p class="eyebrow">YOUR WORLD, YOUR PACE</p>
        <h2>设置</h2>
        <p class="muted">声音即时生效，视觉质量将在下次进入世界时应用。</p>
        <div class="settings-grid">
          {#each buses as bus (bus.key)}
            <label class="volume-control" for={`audio-${bus.key}`}>
              <span>{bus.label}<output>{Math.round(audio.settings[bus.key] * 100)}%</output></span>
              <input
                id={`audio-${bus.key}`}
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={audio.settings[bus.key]}
                oninput={(event) => application.audio.setVolume(bus.key, Number(event.currentTarget.value))}
              />
            </label>
          {/each}
          <label for="settings-quality"
            >视觉质量设置
            <select
              id="settings-quality"
              value={view.quality}
              onchange={(event) => application.setQuality(event.currentTarget.value as ShellQuality)}
            >
              <option value="low">Low · 省电</option><option value="medium">Medium · 均衡</option><option value="high"
                >High · 精致</option
              >
            </select>
          </label>
        </div>
        <div class="reference-music experimental-settings" aria-label="实验性性能">
          <h3>实验性性能</h3>
          <p>TypeScript 优化始终启用。以下选项默认采用实测最优组合，修改会保存并在刷新页面后生效。</p>
          <label class="experimental-renderer" for="settings-renderer"
            ><span>渲染后端</span>
            <select
              id="settings-renderer"
              value={view.experiments.renderer}
              onchange={(event) =>
                application.setExperiment('renderer', event.currentTarget.value as 'webgl2' | 'webgpu')}
            >
              <option value="webgl2">WebGL2 · 推荐</option>
              <option value="webgpu">WebGPU · 实验性</option>
            </select>
          </label>
          <div class="experimental-toggle-list">
            <label class="experimental-toggle" for="settings-wasm">
              <span class="experimental-toggle-copy">
                <strong>Rust WebAssembly</strong>
                <small>w02–w06 · General Worker</small>
              </span>
              <input
                id="settings-wasm"
                type="checkbox"
                checked={view.experiments.wasm}
                onchange={(event) => application.setExperiment('wasm', event.currentTarget.checked)}
              />
            </label>
            <label class:disabled={!view.experiments.wasm} class="experimental-toggle" for="settings-simd">
              <span class="experimental-toggle-copy">
                <strong>标准 SIMD128 · 仅 w06</strong>
                <small>{view.experiments.wasm ? '其他 Rust 内核保持标量' : '需要先启用 Rust WebAssembly'}</small>
              </span>
              <input
                id="settings-simd"
                type="checkbox"
                checked={view.experiments.simd}
                disabled={!view.experiments.wasm}
                onchange={(event) => application.setExperiment('simd', event.currentTarget.checked)}
              />
            </label>
          </div>
          {#if !view.experiments.wasm}<p class="muted">SIMD 仅在 Wasm 开启时生效，偏好会保留。</p>{/if}
          {#if view.appliedExperiments.initializationOverrides.length}
            <p class="muted">
              宿主初始化参数会在每次加载时优先覆盖：{view.appliedExperiments.initializationOverrides.join('、')}
            </p>
          {/if}
          {#if view.experimentsRequireRefresh}
            <p role="status">配置已保存，刷新页面后生效。</p>
            <GameButton label="立即刷新应用实验配置" onclick={() => application.reloadForExperiments()}
              >立即刷新</GameButton
            >
          {/if}
        </div>
        <div class="reference-music">
          <h3>本地参考曲</h3>
          <p>仅在本机播放，不上传。支持 30 MiB / 10 分钟以内的音频；刷新后需重新选择。</p>
          <label for="reference-audio"
            >选择参考曲<input id="reference-audio" type="file" accept="audio/*" onchange={chooseFile} /></label
          >
          {#if audio.referenceName}<p class="reference-name">{audio.referenceName}</p>
            <GameButton label="移除参考曲" onclick={() => application.audio.removeReference()}
              >移除参考曲 · 使用内置音乐</GameButton
            >{/if}
        </div>
        {#if audio.error}<p role="alert" class="start-error">{audio.error}</p>{/if}
        <GameButton label="返回" onclick={() => application.closePanel()}>返回</GameButton>
      {:else if view.panel === 'guide'}
        <p class="eyebrow">FIRST STEPS</p>
        <h2>操作指南</h2>
        <p>
          从附近树木开始：原木合成木板，再制作木斧。向下挖阶梯取石，留出头顶空间并用空格逐级跳回地面；石块可制作石镐和灯笼。
        </p>
        <dl class="control-guide">
          <dt>WASD / 空格</dt>
          <dd>移动 / 跳跃；点击世界捕获鼠标，移动鼠标环顾。</dd>
          <dt>鼠标左键 / 右键</dt>
          <dd>
            采集或攻击 / 放置物品或食用选中的食物。工具可提升采集效率。当前浏览器支持 0–63 层建造，第 0
            层保留为不可采集的基底。
          </dd>
          <dt>数字键 / E 背包</dt>
          <dd>选择物品；E 打开背包整理、合成、装备和食用。点击两个格子可移动或交换物品。</dd>
          <dt>M / Esc</dt>
          <dd>地图 / 暂停。暂停中可设置声音、查看指南、保存退出。</dd>
        </dl>
        <p class="muted">
          采集树叶可得到浆果，饥饿时选中后右键食用。夜行兽有危险，留意生命与夜色；用灯笼照亮营地。死亡后可以重生并找回落下的物品，离开前在暂停菜单保存退出。
        </p>
        <GameButton label="返回" onclick={() => application.closePanel()}>返回</GameButton>
      {:else}
        <p class="eyebrow">A MOMENT OF STILLNESS</p>
        <h2>旅途暂歇</h2>
        <p class="pause-subtitle">世界正在等待你</p>
        <div class="pause-actions">
          <GameButton
            label="继续游戏"
            disabled={view.state.phase === 'saving'}
            onclick={() => application.controller.resume()}>继续游戏</GameButton
          >
          <GameButton
            label="设置"
            disabled={view.state.phase === 'saving'}
            onclick={() => application.openPanel('settings')}>设置</GameButton
          >
          <GameButton
            label="操作指南"
            disabled={view.state.phase === 'saving'}
            onclick={() => application.openPanel('guide')}>操作指南</GameButton
          >
          <GameButton
            label="保存并返回主菜单"
            disabled={view.state.phase === 'saving'}
            onclick={() => void application.controller.leave()}
            >{view.state.phase === 'saving' ? '正在保存旅程…' : '保存并返回主菜单'}</GameButton
          >
        </div>
        {#if view.state.error}<p role="alert" class="start-error">{view.state.error}</p>{/if}
      {/if}
    </GamePanel>
  </div>
{/if}

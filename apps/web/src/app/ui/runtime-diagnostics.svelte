<script lang="ts">
  import type { DebugState, UiActionPort } from './ui-contracts';
  import GameButton from './primitives/game-button.svelte';

  let { debug, actions }: { debug: DebugState; actions: UiActionPort } = $props();
  let selected = $state('overview');
  let compact = $state(false);
  const group = $derived(debug.panel?.groups.find((value) => value.id === selected));
  const sourceLabel = { measured: '观测', configured: '配置', estimated: '估算', unavailable: '未知' } as const;
</script>

<section id="debug" class:compact aria-label="运行指标" hidden={!debug.visible}>
  <header class="diagnostics-header">
    <div>
      <span class="eyebrow">SEEDLANDS / DEVELOPER</span>
      <h2>运行诊断 <span class="live-dot"></span></h2>
    </div>
    <button
      class="density-button"
      aria-label="紧凑诊断布局"
      aria-pressed={compact}
      onclick={() => (compact = !compact)}
    >
      {compact ? '展开' : '紧凑'}
    </button>
  </header>
  <div class="diagnostics-highlights">
    {#each debug.panel?.highlights ?? [] as item (item.label)}
      <div title={item.source}><strong>{item.value}</strong><span>{item.label}</span></div>
    {/each}
  </div>
  <nav class="diagnostics-tabs" aria-label="诊断分类">
    {#each debug.panel?.groups ?? [] as item (item.id)}
      <button aria-pressed={selected === item.id} onclick={() => (selected = item.id)}>{item.label}</button>
    {/each}
  </nav>
  <div class="diagnostics-scroll" role="region" aria-label="诊断详情">
    {#if group}
      <div class="diagnostics-group" data-group={group.id}>
        <p class="group-caption">{group.caption}</p>
        <dl>
          {#each group.metrics as item (item.label)}
            <div class="diagnostics-row" data-kind={item.kind} title={item.source}>
              <dt>{item.label}</dt>

              <dd>{item.value}<span class="source-badge">{sourceLabel[item.kind]}</span></dd>
            </div>
          {/each}
        </dl>
      </div>
    {:else}
      <p class="group-caption">等待世界诊断样本…</p>
    {/if}
    <details class="legacy-diagnostics">
      <summary>地理信息与原始指标</summary>
      <pre class="debug-metrics">{debug.text}</pre>
    </details>
    <details class="collision-details">
      <summary>碰撞与传感器 <span>{debug.collisionDebug ? '已启用' : '未启用'}</span></summary>
      <div class="collision-debug-controls" aria-label="碰撞箱调试">
        <GameButton
          id="collision-debug-toggle"
          label={debug.collisionDebug ? '关闭真实碰撞箱' : '显示真实碰撞箱'}
          pressed={Boolean(debug.collisionDebug)}
          onclick={actions.toggleCollisionDebug}
        >
          {debug.collisionDebug ? '关闭碰撞箱' : '显示碰撞箱'}
        </GameButton>
        <label
          ><input
            id="collision-debug-contacts"
            type="checkbox"
            checked={debug.collisionDebug?.includeContacts ?? false}
            disabled={!debug.collisionDebug}
            onchange={(event) => actions.setCollisionDebugContacts(event.currentTarget.checked)}
          />接触点与法线</label
        >
        <label
          ><input
            id="collision-debug-sensors"
            type="checkbox"
            checked={debug.collisionDebug?.includeSensors ?? true}
            disabled={!debug.collisionDebug}
            onchange={(event) => actions.setCollisionDebugSensors(event.currentTarget.checked)}
          />拾取与吸附传感器</label
        >
      </div>
    </details>
  </div>
  <footer>
    <span>4 Hz · 样本 {debug.panel ? (debug.panel.sampledAtMs / 1000).toFixed(1) : '—'} s</span><span
      >F3 开关 · 单击世界返回操控</span
    >
  </footer>
</section>

<style>
  #debug {
    --diagnostic-accent: #85dac1;
    position: absolute;
    z-index: 8;
    top: 66px;
    left: 14px;
    width: min(472px, calc(100vw - 28px));
    max-width: none;
    max-height: calc(100dvh - 172px);
    padding: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid #57716d;
    border-radius: 8px;
    background: rgb(12 23 28 / 96%);
    box-shadow: 0 12px 40px #0005;
    color: #e8f0eb;
    pointer-events: auto;
    white-space: normal;
    font: 12px/1.45 var(--ui-font-body);
  }
  #debug[hidden] {
    display: none;
  }
  .diagnostics-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 15px 18px 12px;
  }
  .eyebrow {
    font: 9px/1.3 var(--ui-font-mono);
    letter-spacing: 1.6px;
    color: #98abae;
  }
  h2 {
    margin: 3px 0 0;
    color: #f2f6ef;
    font: 600 19px/1.4 var(--ui-font-body);
  }
  .live-dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    margin: 0 0 3px 6px;
    border-radius: 50%;
    background: var(--diagnostic-accent);
  }
  #debug button {
    width: auto;
    min-height: 28px;
    height: auto;
    margin: 0;
    color: #c5d4d2;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 4px;
    padding: 5px 9px;
    cursor: pointer;
    font: inherit;
  }
  button:focus-visible,
  .diagnostics-scroll:focus-visible {
    outline: 2px solid var(--diagnostic-accent);
    outline-offset: -2px;
  }
  #debug .density-button {
    flex: 0 0 auto;
    border-color: #415358;
    font-size: 11px;
  }
  .diagnostics-highlights {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    margin: 0 18px 12px;
    border: 1px solid #31474b;
    border-radius: 5px;
    background: #152c31;
  }
  .diagnostics-highlights > div {
    padding: 10px 8px;
    min-width: 0;
  }
  .diagnostics-highlights > div + div {
    border-left: 1px solid #31474b;
  }
  .diagnostics-highlights strong {
    display: block;
    color: #b8f0db;
    font: 600 17px/1.3 var(--ui-font-mono);
    overflow-wrap: anywhere;
  }
  .diagnostics-highlights span {
    color: #a1b7b9;
    font-size: 10px;
  }
  .diagnostics-tabs {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 2px;
    padding: 0 12px 10px;
    border-bottom: 1px solid #31474b;
  }
  #debug .diagnostics-tabs button {
    padding: 5px 2px;
    font-size: 11px;
  }
  #debug .diagnostics-tabs button[aria-pressed='true'] {
    color: #c8f8e4;
    background: #285048;
    border-color: #527568;
  }
  .diagnostics-scroll {
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
    scrollbar-color: #546e70 transparent;
    min-height: 0;
  }
  .group-caption {
    margin: 12px 18px 7px;
    color: #98adb0;
    font-size: 10px;
  }
  dl {
    margin: 0;
    padding: 0 18px 10px;
  }
  .diagnostics-row {
    display: grid;
    grid-template-columns: minmax(108px, 1fr) minmax(0, 1.35fr);
    gap: 9px;
    padding: 7px 0;
    border-bottom: 1px solid #ffffff09;
    align-items: baseline;
  }
  dt {
    color: #afc2c4;
    font-size: 11px;
  }
  dd {
    margin: 0;
    text-align: right;
    font: 11px/1.5 var(--ui-font-mono);
    overflow-wrap: anywhere;
  }
  .source-badge {
    margin-left: 7px;
    color: #788f94;
    font: 9px/1.3 var(--ui-font-body);
    white-space: nowrap;
  }
  [data-kind='unavailable'] dd {
    color: #7f9297;
  }
  [data-kind='estimated'] .source-badge {
    color: #c2aa72;
  }
  details {
    margin: 0 18px;
    border-top: 1px solid #31474b;
  }
  summary {
    cursor: pointer;
    padding: 10px 0;
    color: #bccdc9;
    font-size: 11px;
  }
  summary span {
    color: #7f999a;
    float: right;
  }
  .debug-metrics {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font: 10px/1.6 var(--ui-font-mono);
    margin: 0 0 12px;
    color: #a7babc;
  }
  .collision-debug-controls {
    display: flex;
    flex-wrap: wrap;
    padding: 0 0 12px;
    margin: 0;
    border: 0;
  }
  .collision-debug-controls label {
    font-size: 10px;
  }
  #debug .collision-debug-controls input {
    width: 14px;
    height: 14px;
    appearance: auto;
    accent-color: var(--diagnostic-accent);
  }
  footer {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    padding: 9px 18px;
    border-top: 1px solid #31474b;
    color: #7f999a;
    font-size: 9px;
  }
  .compact .diagnostics-header {
    padding: 9px 14px;
  }
  .compact .diagnostics-highlights {
    display: none;
  }
  .compact .diagnostics-row {
    padding: 4px 0;
  }
  .compact .source-badge {
    display: none;
  }
  @media (max-width: 600px) {
    #debug {
      left: 10px;
      width: calc(100vw - 20px);
      max-height: calc(100dvh - 150px);
    }
    .diagnostics-header {
      padding: 10px 14px;
    }
    .diagnostics-highlights {
      margin: 0 14px 8px;
    }
    .diagnostics-highlights strong {
      font-size: 14px;
    }
    .diagnostics-row {
      grid-template-columns: minmax(95px, 1fr) minmax(0, 1.3fr);
    }
    .source-badge {
      display: none;
    }
    footer {
      padding: 8px 12px;
      font-size: 8px;
    }
  }
</style>

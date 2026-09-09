<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { CompanionSession } from '../gameplay/companion/companion-session';
  let {
    session,
    releaseInput,
    canOpen = true,
  }: {
    session: CompanionSession;
    releaseInput: () => void;
    canOpen?: boolean;
  } = $props();
  const initialState = () => session.get();
  let view = $state(initialState());
  let open = $state(false);
  let settings = $state(false);
  let text = $state('');
  let url = $state('ws://127.0.0.1:8787');
  let token = $state('');
  let minutes = $state(3);
  let context = $state<128000 | 256000>(128000);
  const goals: Record<string, string> = {
    idle: '稍作休息',
    forage: '寻找食物',
    'return-home': '回到落脚处',
    follow: '陪伴同行',
    'move-to': '前往目的地',
  };
  const behavior: Record<string, string> = {
    idle: '观察周围',
    roam: '四处探索',
    forage: '寻找食物',
    flee: '避开危险',
    follow: '正在跟随',
    eat: '补充体力',
    'move-to': '赶路中',
    'return-home': '回家路上',
    dead: '已失去生命',
  };
  onMount(() => {
    const unsubscribe = session.subscribe((value) => (view = value));
    const keydown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        !canOpen ||
        event.defaultPrevented ||
        event.repeat ||
        event.code !== 'KeyT' ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        (target instanceof HTMLElement &&
          (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)))
      )
        return;
      event.preventDefault();
      open = true;
      releaseInput();
      void tick().then(() => document.getElementById('companion-dialogue')?.focus());
    };
    window.addEventListener('keydown', keydown);
    return () => {
      unsubscribe();
      window.removeEventListener('keydown', keydown);
    };
  });
  function toggle() {
    open = !open;
    if (open) releaseInput();
  }
  async function speak() {
    const message = text.trim();
    if (!message) return;
    await session.dialogue(message);
    if (!view.error) text = '';
  }
  function configure() {
    session.configure(Number(minutes) * 60, Number(context) as 128000 | 256000);
  }
</script>

<aside id="companion" class:expanded={open} aria-label="世界伙伴" hidden={!canOpen}>
  <button
    class="companion-toggle"
    onclick={toggle}
    aria-expanded={open}
    aria-controls="companion-content"
    title="T · 和伙伴交流"
  >
    <span class="avatar" aria-hidden="true">岚</span>
    <span class="identity"
      ><strong>{view.character?.profile.name ?? '结识旅伴'}</strong><small
        >{view.character?.lifecycle === 'deceased'
          ? '留下的故事'
          : view.character
            ? `${behavior[view.character.behavior] ?? '正在生活'} · T 交流`
            : 'T · 邀请一位新旅伴'}</small
      ></span
    >
    <span class="indicator" data-phase={view.connection.phase}></span>
    <span aria-hidden="true">{open ? '−' : '+'}</span>
  </button>
  {#if open}
    <div id="companion-content">
      {#if !view.character}
        <p class="intro">阿岚是一位谨慎而好奇的旅行者，会寻找食物、探索周围，也会因你的到来改变计划。</p>
        <button class="primary" disabled={view.busy} onclick={() => session.create()}>邀请阿岚进入世界</button>
      {:else}
        <div class="plan">
          <small>{view.character.lifecycle === 'deceased' ? '旅程的终点' : '此刻的打算'}</small><strong
            >{view.character.lifecycle === 'deceased'
              ? `${view.character.profile.name}已经离世`
              : (goals[view.character.currentGoal.goal.kind] ?? '自由探索')}</strong
          ><span
            >{view.character.lifecycle === 'deceased'
              ? '经历与留下的痕迹仍在这个世界里。'
              : view.character.currentGoal.status === 'failed'
                ? '遇到了阻碍，正在调整'
                : view.character.currentGoal.status === 'suspended'
                  ? '先处理眼前的事'
                  : '一步一步地继续'}</span
          >
        </div>
        <div class="vitals">
          <span
            >生命 <b>{view.observation?.self.health === undefined ? '—' : Math.round(view.observation.self.health)}</b
            ></span
          >
          <span>饥饿 <b>{Math.round(view.character.hunger)}</b></span>
          <span>行囊 <b>{view.character.inventory.reduce((count, slot) => count + (slot?.count ?? 0), 0)}</b></span>
        </div>
        {#if view.character.lastSpeech}<blockquote data-testid="companion-speech">
            “{view.character.lastSpeech}”
          </blockquote>{/if}
        <div class="conversation" aria-label="最近经历">
          {#each (view.observation?.events ?? []).filter((event) => event.text).slice(-5) as event (event.cursor)}
            <p class:heard={event.type === 'dialogue-heard'}>
              <small
                >{event.type === 'dialogue-heard'
                  ? '你说'
                  : event.type === 'speech'
                    ? view.character.profile.name
                    : '经历'}</small
              >{event.text}
            </p>
          {/each}
        </div>
        {#if view.character.lifecycle === 'active'}
          <form
            onsubmit={(event) => {
              event.preventDefault();
              void speak();
            }}
          >
            <label for="companion-dialogue">和{view.character.profile.name}说句话</label>
            <div class="compose">
              <input
                id="companion-dialogue"
                bind:value={text}
                maxlength="280"
                placeholder="一起去找点吃的吧？"
                onfocus={releaseInput}
              /><button class="primary" type="submit" disabled={view.busy || !text.trim()}>说话</button>
            </div>
          </form>
          <p class="connection" role="status">{view.connection.message}</p>
          <button class="settings-toggle" onclick={() => (settings = !settings)} aria-expanded={settings}
            >思考设置 <span>{settings ? '收起' : '展开'}</span></button
          >
          {#if settings}
            <div class="settings">
              <label for="companion-frequency">思考频率 <strong>最多等待 {minutes} 分钟</strong></label>
              <input
                id="companion-frequency"
                type="range"
                min="1"
                max="10"
                step="1"
                bind:value={minutes}
                oninput={configure}
              />
              <p class="hint">重要事件会提前触发思考；等待期间仍会执行计划。更频繁会消耗更多模型额度。</p>
              <label for="companion-context">经历窗口</label>
              <select id="companion-context" bind:value={context} onchange={configure}
                ><option value={128000}>128K · 默认</option><option value={256000}>256K · 更长经历</option></select
              >
              <label for="companion-url">本机思考服务</label><input
                id="companion-url"
                bind:value={url}
                spellcheck="false"
              />
              <label for="companion-token">配对码</label><input
                id="companion-token"
                type="password"
                bind:value={token}
                autocomplete="off"
                placeholder="启动本机服务后获得"
              />
              <div class="connection-actions">
                <button
                  class="primary"
                  disabled={view.busy || !token.trim()}
                  onclick={() => session.connect(url, token)}>连接</button
                ><button onclick={session.disconnect}>断开</button>
              </div>
              {#if view.connection.usage}<p class="hint">
                  本次连接：{view.connection.usage.calls} 次决定 · {view.connection.usage.compressionCalls} 次整理
                </p>{/if}
            </div>
          {/if}
        {/if}
      {/if}
      {#if view.error}<p class="error" role="alert">{view.error}</p>{/if}
    </div>
  {/if}
</aside>

<style>
  #companion {
    position: absolute;
    right: 20px;
    top: 104px;
    width: 292px;
    pointer-events: auto;
    color: #f4eedc;
    background: rgb(23 33 30 / 94%);
    border: 1px solid #647565;
    border-radius: 14px;
    box-shadow: 0 8px 28px #0005;
    font:
      13px/1.5 system-ui,
      sans-serif;
    overflow: hidden;
  }
  button,
  input,
  select {
    font: inherit;
  }
  button {
    cursor: pointer;
    color: inherit;
    border: 1px solid #5e7564;
    border-radius: 7px;
    padding: 7px 10px;
    background: #31483b;
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  button:hover:not(:disabled) {
    background: #48654e;
  }
  button:focus-visible,
  input:focus-visible,
  select:focus-visible {
    outline: 2px solid #eac67e;
    outline-offset: 2px;
  }
  .companion-toggle {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px;
    border: 0;
    border-radius: 0;
    background: transparent;
    text-align: left;
  }
  .avatar {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    background: #84976b;
    color: #1e3026;
    border-radius: 10px;
    font-weight: 800;
    font-size: 18px;
  }
  .identity {
    display: flex;
    flex-direction: column;
    flex: 1;
  }
  .identity strong {
    font-size: 15px;
  }
  .identity small {
    font-size: 11px;
    color: #b2c0ae;
  }
  .indicator {
    width: 7px;
    height: 7px;
    background: #8b977e;
    border-radius: 50%;
  }
  .indicator[data-phase='thinking'],
  .indicator[data-phase='compressing'] {
    background: #eac67e;
  }
  .indicator[data-phase='ready'] {
    background: #9fda95;
  }
  #companion-content {
    border-top: 1px solid #4b5c4c;
    padding: 14px;
    max-height: min(68vh, 660px);
    overflow-y: auto;
  }
  .intro {
    margin: 0 0 12px;
    color: #c6cebe;
  }
  .primary {
    background: #cfb67c;
    color: #263628;
    border-color: #cfb67c;
    font-weight: 700;
  }
  .primary:hover:not(:disabled) {
    background: #e2c995;
  }
  .plan {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .plan small {
    font-size: 10px;
    letter-spacing: 2px;
    color: #a7b59e;
  }
  .plan strong {
    font-size: 20px;
  }
  .plan span {
    color: #bdc8b5;
    font-size: 11px;
  }
  .vitals {
    display: flex;
    justify-content: space-between;
    margin: 14px 0;
    padding: 9px 0;
    border-block: 1px solid #425444;
    color: #b8c5b0;
    font-size: 11px;
  }
  .vitals b {
    color: #e9d5a5;
    margin-left: 5px;
  }
  blockquote {
    margin: 10px 0;
    padding: 10px 12px;
    border-left: 2px solid #c8ae77;
    color: #f2deae;
    background: #d3bd7810;
  }
  .conversation {
    max-height: 120px;
    overflow: auto;
  }
  .conversation p {
    margin: 6px 0;
    font-size: 11px;
    color: #c1cbb8;
  }
  .conversation small {
    margin-right: 7px;
    color: #d6bd87;
  }
  .conversation .heard {
    color: #adbda3;
  }
  label {
    display: block;
    font-size: 11px;
    color: #bccab3;
    margin: 10px 0 5px;
  }
  input,
  select {
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    padding: 8px;
    background: #15241d;
    border: 1px solid #4d6352;
    border-radius: 6px;
    color: #f4eedc;
  }
  .compose {
    display: flex;
    gap: 6px;
  }
  .compose input {
    flex: 1;
  }
  .compose button {
    flex: 0 0 auto;
    width: auto;
  }
  input[type='range'] {
    padding: 0;
    accent-color: #d2b77b;
  }
  .connection {
    font-size: 11px;
    color: #a7b99e;
    margin: 12px 0;
  }
  .settings-toggle {
    display: flex;
    justify-content: space-between;
    width: 100%;
    border: 0;
    background: transparent;
    padding: 8px 0;
    border-top: 1px solid #425444;
    color: #afbfaa;
    font-size: 11px;
  }
  .settings-toggle span {
    color: #d6bd87;
  }
  .settings label strong {
    float: right;
    font-weight: 400;
  }
  .hint {
    font-size: 10px;
    color: #9eae97;
  }
  .connection-actions {
    display: flex;
    gap: 8px;
    margin-top: 12px;
  }
  .error {
    color: #ffbca6;
    font-size: 12px;
  }
  @media (max-width: 700px) {
    #companion {
      right: 8px;
      top: 66px;
      width: 250px;
    }
  }
</style>

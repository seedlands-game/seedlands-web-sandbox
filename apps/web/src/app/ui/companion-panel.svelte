<script lang="ts">
  import './companion-panel.css';
  import { onMount, tick } from 'svelte';
  import type { CompanionSession } from '../gameplay/companion/companion-session';
  import CharacterBehaviorPanel from './character-behavior-panel.svelte';
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
  let birthTags = $state('好奇, 种植, 珍惜朋友');
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
    session.configure(Number(minutes) * 60);
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
    <span class="avatar" aria-hidden="true">{view.character?.profile.name.slice(0, 1) ?? '友'}</span>
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
      {#if view.characters.length}
        <nav class="residents" aria-label="选择伙伴">
          {#each view.characters as character (character.entityId)}
            <button
              class:selected={character.entityId === view.character?.entityId}
              onclick={() => session.select(character.entityId)}>{character.profile.name}</button
            >
          {/each}
          {#if view.characters.filter((entry) => entry.lifecycle === 'active').length < 3}
            <button disabled={view.busy} onclick={() => session.create()} aria-label="邀请另一位伙伴">＋</button>
          {/if}
        </nav>
      {/if}
      {#if !view.character}
        <p class="intro">阿岚是一位谨慎而好奇的旅行者，会寻找食物、探索周围，也会因你的到来改变计划。</p>
        <button class="primary" disabled={view.busy} onclick={() => session.create()}>邀请阿岚进入世界</button>
      {:else}
        <div class="plan">
          <small>{view.character.lifecycle === 'deceased' ? '旅程的终点' : '此刻的打算'}</small><strong
            >{view.character.lifecycle === 'deceased'
              ? `${view.character.profile.name}已经离世`
              : (view.character.behaviorTree?.goal.description ??
                goals[view.character.currentGoal.goal.kind] ??
                '自由探索')}</strong
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
        {#if view.character.behaviorTree}
          <CharacterBehaviorPanel behavior={view.character.behaviorTree} />
        {/if}
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
              /><button
                class="primary"
                type="submit"
                disabled={view.busy || view.connection.phase === 'connecting' || !text.trim()}>说话</button
              >
            </div>
          </form>
        {/if}
      {/if}
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
          <p class="hint">经历窗口 128K · 接近 112K 时由 Pro 整理记忆。整理与断线期间，伙伴继续执行当前行为树。</p>
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
            <button class="primary" disabled={view.busy || !token.trim()} onclick={() => session.connect(url, token)}
              >连接</button
            ><button onclick={session.disconnect}>断开</button>
          </div>
          {#if view.cognition}
            <div class="cognition-stats" aria-label="认知状态">
              <span>思考 <b>{view.cognition.logicalRounds}</b> 次</span>
              <span>整理 <b>{view.cognition.compactions}</b> 次</span>
              <span>上下文约 <b>{Math.round(view.cognition.estimatedContextTokens / 1000)}K</b></span>
              <p>{view.cognition.message}</p>
              <small
                >事件已保存 {view.cognition.receivedThrough} · 已纳入 {view.cognition.includedThrough} · 已整理 {view
                  .cognition.compactedThrough}</small
              >
            </div>
            <div class="documents" aria-label="伙伴工作区">
              {#each ['/AGENT.md', '/SOUL.md', '/MEMORY.md', '/behavior/current.json'] as path (path)}
                <button
                  disabled={view.busy}
                  onclick={() =>
                    session.readDocument(path as '/AGENT.md' | '/SOUL.md' | '/MEMORY.md' | '/behavior/current.json')}
                  >{path.split('/').at(-1)}</button
                >
              {/each}
            </div>
          {/if}
          {#if view.connection.phase === 'ready' && view.characters.filter((entry) => entry.lifecycle === 'active').length < 3}
            <label for="companion-birth-tags">下一位伙伴的性格与经历</label>
            <input id="companion-birth-tags" bind:value={birthTags} maxlength="240" />
            <button
              disabled={view.busy || !birthTags.trim()}
              onclick={() =>
                session.create(
                  birthTags
                    .split(/[,，]/u)
                    .map((value) => value.trim())
                    .filter(Boolean),
                )}>由 Pro 创作并邀请伙伴</button
            >
          {/if}
        </div>
      {/if}
      <details class="application-save">
        <summary>世界与伙伴存档</summary>
        <button disabled={view.busy} onclick={() => session.resumeWorld()}>继续这个世界</button>
        <p class="hint">连接思考服务时，会一起保存世界、伙伴记忆和完整会话。恢复后世界暂停，确认后可继续。</p>
        <button disabled={view.busy} onclick={() => session.exportCheckpoint()}>准备此刻的存档</button>
        {#if view.download}<a href={view.download.url} download={view.download.filename}>下载世界与伙伴存档</a>{/if}
        <label for="application-checkpoint">恢复存档文件</label>
        <input
          id="application-checkpoint"
          type="file"
          accept="application/json,.json"
          disabled={view.busy}
          onchange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) void session.importCheckpoint(file);
            event.currentTarget.value = '';
          }}
        />
      </details>
      {#if view.document}
        <section class="workspace-document" aria-label="工作区文档">
          <div><strong>{view.document.path}</strong><button onclick={session.closeDocument}>关闭</button></div>
          <pre>{view.document.content}</pre>
        </section>
      {/if}
      {#if view.notice}<p class="hint" role="status">{view.notice}</p>{/if}
      {#if view.error}<p class="error" role="alert">{view.error}</p>{/if}
    </div>
  {/if}
</aside>

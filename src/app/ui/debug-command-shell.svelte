<script lang="ts">
  import { tick } from 'svelte';
  import { CommandHistory } from '../command-history';
  import type { UiActionPort } from './ui-contracts';
  import GameOverlay from './primitives/game-overlay.svelte';

  let { open, actions }: { open: boolean; actions: UiActionPort } = $props();
  let input = $state('');
  let inputElement = $state<HTMLInputElement>();
  let running = $state(false);
  let status = $state('输入 slash command，按 Enter 执行。');
  let statusState = $state<'idle' | 'running' | 'success' | 'error'>('idle');
  let entries = $state<Array<{ input: string; state: 'success' | 'error'; summary: string }>>([]);
  const history = new CommandHistory(20);
  let previousOpen = false;

  $effect(() => {
    if (open && !previousOpen) {
      actions.releaseInput();
      void tick().then(() => inputElement?.focus());
    }
    previousOpen = open;
  });

  const close = () => {
    actions.closeCommandShell();
    inputElement?.blur();
  };

  const submit = async () => {
    const command = input.trim();
    if (!command || running) return;
    history.record(command);
    running = true;
    statusState = 'running';
    status = '执行中…';
    try {
      const execution = await actions.executeCommand(command);
      const state = execution.result.success ? 'success' : 'error';
      const summary = execution.result.success
        ? execution.result.message
        : `${execution.result.error.code} · ${execution.result.error.message}`;
      entries = [...entries.slice(-19), { input: command, state, summary }];
      statusState = state;
      status = `${state === 'success' ? '成功' : '错误'} · ${summary}`;
      input = '';
    } finally {
      running = false;
      if (open) await tick().then(() => inputElement?.focus());
    }
  };

  const handleKeydown = (event: KeyboardEvent) => {
    event.stopPropagation();
    if (event.code === 'Escape' || event.code === 'F4') {
      event.preventDefault();
      close();
    } else if (event.code === 'ArrowUp') {
      event.preventDefault();
      input = history.previous(input);
    } else if (event.code === 'ArrowDown') {
      event.preventDefault();
      input = history.next(input);
    }
  };
</script>

<GameOverlay id="debug-command-shell" label="服务端调试命令" {open}>
  <header><strong>Server Debug Shell</strong><span>F4 / Esc 关闭</span></header>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div id="debug-command-log" role="log" aria-label="最近命令输出" tabindex="0">
    {#each entries as entry, index (`${entry.input}-${index}`)}
      <div class="debug-command-entry" data-state={entry.state}>
        <code>› {entry.input}</code><span>{entry.summary}</span>
      </div>
    {/each}
  </div>
  <form
    id="debug-command-form"
    onsubmit={(event) => {
      event.preventDefault();
      void submit();
    }}
  >
    <label for="debug-command-input">命令</label>
    <div class="command-line">
      <span aria-hidden="true">›</span>
      <input
        id="debug-command-input"
        name="command"
        bind:this={inputElement}
        bind:value={input}
        disabled={running}
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        placeholder="/inspect voxel 0 0 0"
        onkeydown={handleKeydown}
        onkeyup={(event) => event.stopPropagation()}
        oninput={() => history.resetNavigation()}
      />
    </div>
  </form>
  <div id="debug-command-status" role="status" aria-live="polite" data-state={statusState}>{status}</div>
  <small>↑↓ 历史 · /seed · /inspect · /setblock · /fill · /tp · /time · /save</small>
</GameOverlay>

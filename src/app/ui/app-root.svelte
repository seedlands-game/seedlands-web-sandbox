<script lang="ts">
  import { onMount } from 'svelte';
  import type { UiBridge } from './ui-bridge';
  import type { DebugState, HudState, InteractionState, ShellState, UiActionPort } from './ui-contracts';
  import DebugCommandShell from './debug-command-shell.svelte';
  import Hotbar from './hotbar.svelte';
  import MacroMap from './macro-map.svelte';
  import GameButton from './primitives/game-button.svelte';
  import GamePanel from './primitives/game-panel.svelte';
  import StartScreen from './start-screen.svelte';
  import ShellOverlays from './shell-overlays.svelte';
  import type { ApplicationShell } from '../application-shell';

  let {
    bridge,
    actions,
    application,
    buildWatermark = '',
    buildCommit = '',
  }: {
    bridge: UiBridge;
    actions: UiActionPort;
    application: ApplicationShell;
    buildWatermark?: string;
    buildCommit?: string;
  } = $props();
  const readInitialState = () => ({
    shell: bridge.shell.get(),
    hud: bridge.hud.get(),
    interaction: bridge.interaction.get(),
    debug: bridge.debug.get(),
  });
  const initial = readInitialState();
  let shell = $state<ShellState>(initial.shell);
  let hud = $state<HudState>(initial.hud);
  let interaction = $state<InteractionState>(initial.interaction);
  let debug = $state<DebugState>(initial.debug);
  let commitStartedAt = 0;

  const subscribe = <Value,>(
    channel: { subscribe: (subscriber: (value: Value) => void) => () => void },
    set: (value: Value) => void,
  ) =>
    channel.subscribe((value) => {
      commitStartedAt = performance.now();
      set(value);
      queueMicrotask(() => {
        if (commitStartedAt) bridge.recordDomCommit(performance.now() - commitStartedAt);
        commitStartedAt = 0;
      });
    });

  onMount(() => {
    const unsubscribers = [
      subscribe(bridge.shell, (value) => (shell = value)),
      subscribe(bridge.hud, (value) => (hud = value)),
      subscribe(bridge.interaction, (value) => (interaction = value)),
      subscribe(bridge.debug, (value) => (debug = value)),
    ];
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  });
</script>

<StartScreen {shell} {application} onstart={(seed, quality) => void actions.startWorld(seed, quality)} />
<ShellOverlays {application} />

<section id="hud" hidden={!hud.visible} aria-label="游戏 HUD">
  <div id="crosshair" aria-label="准星"><span></span></div>
  <div id="world-clock" class="hud-chip">{hud.worldClock}</div>
  <div
    id="interaction-feedback"
    role="status"
    aria-live="polite"
    data-visible={interaction.feedback ? 'true' : 'false'}
    data-tone={interaction.feedback?.tone ?? 'info'}
  >
    {interaction.feedback?.message ?? ''}
  </div>
  <GamePanel id="debug" label="运行指标" hidden={!debug.visible}>{debug.text}</GamePanel>
  <DebugCommandShell open={shell.commandOpen} {actions} />
  <GameButton id="map-toggle" class="game-panel map-toggle" label="Macro 地图" onclick={actions.toggleMap}>
    Macro 地图
  </GameButton>
  <MacroMap {shell} {actions} />
  <div id="help" class="game-panel">
    WASD 移动 · 空格跳跃 · 左/右键采集与放置 · 1–4 选材质 · M 地图 · F3 指标 · F4 命令 · P 暂停时间
  </div>
  <Hotbar slots={hud.hotbar} selected={hud.selectedMaterial} onselect={actions.selectMaterial} />
</section>

{#if buildWatermark}
  <div
    id="build-watermark"
    data-commit={buildCommit}
    aria-label={`Build ${buildWatermark}`}
    title={`Seedlands Web Sandbox build ${buildCommit}`}
  >
    {buildWatermark}
  </div>
{/if}

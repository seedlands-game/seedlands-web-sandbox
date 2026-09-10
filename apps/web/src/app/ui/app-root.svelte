<script lang="ts">
  import CompanionPanel from './companion-panel.svelte';
  import { onMount } from 'svelte';
  import type { UiBridge } from './ui-bridge';
  import type { DebugState, HudState, InteractionState, ShellState, UiActionPort } from './ui-contracts';
  import DebugCommandShell from './debug-command-shell.svelte';
  import DeathOverlay from './death-overlay.svelte';
  import Hotbar from './hotbar.svelte';
  import InventoryCrafting from './inventory-crafting.svelte';
  import MacroMap from './macro-map.svelte';
  import GameButton from './primitives/game-button.svelte';
  import RuntimeDiagnostics from './runtime-diagnostics.svelte';
  import StartScreen from './start-screen.svelte';
  import ShellOverlays from './shell-overlays.svelte';
  import type { ApplicationShell } from '../application-shell';
  import PlayerActionPresentation from './player-action-presentation.svelte';
  import TargetCard from './target-card.svelte';
  import SurvivalHud from './survival-hud.svelte';
  import CombatStatus from './combat-status.svelte';
  import PresentedEntities from './presented-entities.svelte';
  import MeleeShowcaseGuide from './melee-showcase-guide.svelte';

  let {
    bridge,
    actions,
    application,
    assetBase = import.meta.env.BASE_URL,
    buildWatermark = '',
    buildCommit = '',
  }: {
    bridge: UiBridge;
    actions: UiActionPort | null;
    application: ApplicationShell | null;
    assetBase?: string;
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
  let clientReady = $state(false);
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
    clientReady = true;
    const unsubscribers = [
      subscribe(bridge.shell, (value) => (shell = value)),
      subscribe(bridge.hud, (value) => (hud = value)),
      subscribe(bridge.interaction, (value) => (interaction = value)),
      subscribe(bridge.debug, (value) => (debug = value)),
    ];
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  });
</script>

<StartScreen
  {shell}
  {application}
  {assetBase}
  onstart={(seed, quality, openMode, actorMode) => void actions?.startWorld(seed, quality, openMode, actorMode)}
  onstartshowcase={(quality) => void actions?.startMeleeShowcase(quality)}
/>

{#if clientReady && application && actions}
  <ShellOverlays {application} />

  <section id="hud" hidden={!hud.visible} aria-label="游戏 HUD">
    <div id="crosshair" aria-label="准星"><span></span></div>
    <div id="world-clock" class="game-panel">{hud.worldClock}</div>
    <TargetCard {interaction} />
    {#if shell.experience === 'melee-showcase'}
      <MeleeShowcaseGuide {actions} />
    {/if}
    {#if !shell.gameplay.inventoryOpen && !shell.mapOpen && !shell.commandOpen && shell.gameplay.lifecycle === 'alive'}
      <PlayerActionPresentation {hud} {interaction} />
      <CombatStatus combat={hud.combat} />
    {/if}
    <div
      id="interaction-feedback"
      role="status"
      aria-label="交互反馈"
      aria-live="polite"
      data-visible={interaction.feedback ? 'true' : 'false'}
      data-tone={interaction.feedback?.tone ?? 'info'}
    >
      {interaction.feedback?.message ?? ''}
    </div>
    <RuntimeDiagnostics {debug} {actions} />
    {#if actions.companion && hud.visible}
      <CompanionPanel
        session={actions.companion}
        releaseInput={actions.releaseInput}
        canOpen={shell.phase === 'playing' &&
          shell.gameplay.lifecycle === 'alive' &&
          !debug.visible &&
          !shell.gameplay.inventoryOpen &&
          !shell.mapOpen &&
          !shell.commandOpen}
      />
    {/if}
    <DebugCommandShell open={shell.commandOpen} {actions} />
    <GameButton id="map-toggle" class="game-panel map-toggle" label="Macro 地图" onclick={actions.toggleMap}>
      Macro 地图
    </GameButton>
    {#if hud.mode === 'creative'}
      <GameButton
        id="flight-toggle"
        class="game-panel flight-toggle"
        label={hud.flightEnabled ? '关闭飞行' : '开启飞行'}
        onclick={() => actions.setFlight(!hud.flightEnabled)}
      >
        {hud.flightEnabled ? '飞行开启' : '开启飞行'}
      </GameButton>
    {/if}
    <MacroMap {shell} {actions} />
    <InventoryCrafting gameplay={shell.gameplay} {actions} />
    <DeathOverlay dead={shell.gameplay.lifecycle === 'dead'} {actions} />
    {#if hud.visible && debug.visible}<PresentedEntities entities={interaction.presentedEntities} />{/if}
    <div id="help" class="game-panel">
      {hud.mode === 'creative'
        ? 'WASD 移动 · Space 上升 · Shift 下降 · 左/右键编辑 · 1–8 创造快捷栏 · E 内容目录 · M 地图'
        : 'WASD 移动 · 空格跳跃 · 左/右键采集与放置 · 1–8 快捷栏 · E 背包 · M 地图 · F3 指标 · F3+B 碰撞箱 · F4 命令'}
    </div>
    <div id="survival-deck">
      <div id="held-item-name">
        {hud.hotbar[hud.selectedHotbarSlot]?.itemId ? hud.hotbar[hud.selectedHotbarSlot].name : ''}
      </div>
      <SurvivalHud {hud} damage={interaction.gesture?.kind === 'damage' ? interaction.gesture : null} />
      <Hotbar
        slots={hud.hotbar}
        selected={hud.selectedHotbarSlot}
        mode={hud.mode}
        onselect={actions.selectHotbarSlot}
      />
    </div>
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
{/if}

<style>
  :global(#ui #flight-toggle) {
    position: absolute;
    top: 64px;
    right: 140px;
    width: auto;
    min-height: 32px;
    padding: 5px 12px;
    pointer-events: auto;
  }
  @media (max-width: 720px) {
    :global(#ui #flight-toggle) {
      top: 52px;
      right: 110px;
      font-size: 11px;
    }
  }
</style>

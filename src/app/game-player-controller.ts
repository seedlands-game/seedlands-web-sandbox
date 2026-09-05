import type * as pc from 'playcanvas';
import type { BrowserAuthorityClient } from '../client/browser-authority-client';
import type { PerformanceTelemetry } from '../client/performance-telemetry';
import type { UiBridge, UiWorldSession } from './ui/ui-bridge';
import type { WorldEnvironment } from './world-environment';
import type { World } from './world-runtime';
import type { BrowserGameplay } from './browser-gameplay';
import { PlayerController } from './player-controller';
import type { AuthorityReady } from '../worker/authority-worker-protocol';

type Options = Readonly<{
  camera: pc.Entity;
  canvas: HTMLCanvasElement;
  telemetry: PerformanceTelemetry;
  authority: BrowserAuthorityClient;
  getWorld: () => World | null;
  getEnvironment: () => WorldEnvironment | null;
  isPaused: () => boolean;
  uiBridge: UiBridge;
  getGameplay: () => BrowserGameplay | null;
  getUiSession: () => UiWorldSession | null;
  nextInteractionSequence: () => number;
  queueSave: () => void;
  flushSave: () => void;
  actions: Readonly<{
    toggleMap: () => void;
    toggleDebug: () => void;
    toggleCollisionDebug: () => void;
    toggleCommandShell: () => void;
    toggleInventory: () => void;
    setWorldClockPaused: (paused: boolean) => void;
    setWorldClockSpeed: (speed: number) => void;
    closeMap: () => void;
    closeCommandShell: () => void;
    closeInventory: () => void;
    selectHotbarSlot: (slot: number) => void;
  }>;
}>;

export function createGamePlayerController(options: Options): PlayerController {
  const gameplay = () => options.getGameplay();
  return new PlayerController({
    camera: options.camera,
    canvas: options.canvas,
    telemetry: options.telemetry,
    getWorld: options.getWorld,
    getEnvironment: options.getEnvironment,
    isPaused: options.isPaused,
    onToggleMap: options.actions.toggleMap,
    onToggleDebug: options.actions.toggleDebug,
    onToggleCollisionDebug: options.actions.toggleCollisionDebug,
    onToggleCommandShell: options.actions.toggleCommandShell,
    onToggleInventory: options.actions.toggleInventory,
    onSetWorldClockPaused: options.actions.setWorldClockPaused,
    onSetWorldClockSpeed: options.actions.setWorldClockSpeed,
    onSelectHotbarSlot: options.actions.selectHotbarSlot,
    onAttackTarget: (origin, direction, maxDistance) =>
      gameplay()?.attackTarget(origin, direction, maxDistance) ?? false,
    onAimTarget: (target) => gameplay()?.setAimTarget(target),
    onBeginBreak: (position) => gameplay()?.beginBreak(position),
    onCancelBreak: () => gameplay()?.cancelBreak(),
    onPlace: (position) => gameplay()?.place(position),
    onUseHeldItem: () => gameplay()?.useHeldItem() ?? false,
    isUiBlockingInput: () =>
      Boolean(
        gameplay()?.blocksInput || options.uiBridge.shell.get().commandOpen || options.uiBridge.shell.get().mapOpen,
      ),
    onCloseUi: () => {
      options.actions.closeInventory();
      options.actions.closeMap();
      options.actions.closeCommandShell();
    },
    onFeedback: (message, tone) =>
      options.getUiSession()?.publishFeedback(options.nextInteractionSequence(), { message, tone, durationMs: 900 }),
    onQueueSave: options.queueSave,
    onFlushSave: options.flushSave,
    authority: {
      epoch: options.authority.epoch,
      snapshot: () => options.authority.snapshot,
      sendInput: (command) => options.authority.sendInput(command),
      setPlayerPosition: (position) => options.authority.setPlayerPosition(position),
    },
    physicsHz: options.authority.readyState?.frequencies.physicsHz ?? 60,
    estimatedOneWayLatencyMs: options.authority.estimatedOneWayLatencyMs,
  });
}

export function orientPlayerTowardCamp(controller: PlayerController, ready: AuthorityReady): void {
  if (!ready.isNew || !ready.campPosition) return;
  const [x, y, z] = ready.playerBodyPosition;
  const dx = ready.campPosition[0] - x;
  const dz = ready.campPosition[2] - z;
  controller.setView(
    (Math.atan2(-dx, -dz) * 180) / Math.PI,
    (Math.atan2(ready.campPosition[1] + 1.2 - y, Math.hypot(dx, dz)) * 180) / Math.PI,
  );
}

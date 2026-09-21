import type * as pc from 'playcanvas';
import { releasePointerLock } from './player/pointer-lock';
import type { MapLayer } from './ui/ui-contracts';
import type { BrowserAuthorityClient } from '../client/authority/browser-authority-client';
import type { UiBridge, UiWorldSession } from './ui/ui-bridge';
import type { WorldEnvironment } from './scene/world-environment';
import type { World } from './world/world-runtime';
import type { WorldAudio } from './audio/world-audio';
import type { CompanionSession } from './gameplay/companion/companion-session';
import type { PlayerController } from './player/player-controller';
import type { ServerCommand } from '@seedlands/stdlib/server/commands/command-contract';
import type { CommandResult } from '@seedlands/stdlib/server/commands/command-contract';

export function consumeBrowserCommand(
  command: ServerCommand,
  result: Extract<CommandResult, { success: true }>,
  options: Readonly<{
    queueSave(): void;
    playerId: string | null;
    playerPosition(): readonly [number, number, number] | null;
    movePlayer(position: readonly [number, number, number]): void;
    setEnvironmentTime(): void;
    refreshGameplay(): void;
  }>,
) {
  if (result.commit) options.queueSave();
  if (command.type === 'teleport' && options.playerId) {
    const position = options.playerPosition();
    if (position) options.movePlayer(position);
  }
  if (command.type === 'time-set') options.setEnvironmentTime();
  options.refreshGameplay();
}

export async function executeBrowserCommand(
  executor: { execute(source: unknown, command: ServerCommand): Promise<CommandResult> } | null,
  source: unknown,
  command: ServerCommand,
  consume: (command: ServerCommand, result: Extract<CommandResult, { success: true }>) => void,
) {
  if (!executor || !source) throw new Error('Gameplay command runtime is unavailable.');
  const result = await executor.execute(source, command);
  if (result.success) consume(command, result);
  return result;
}

export function setGamePaused(
  paused: boolean,
  options: Readonly<{
    companion: CompanionSession;
    controller: PlayerController | null;
    authority: BrowserAuthorityClient | null;
    gameplay: { setSuspended(value: boolean): void } | null;
    audio: WorldAudio | null;
    camera: pc.Entity | null;
    world: World | null;
  }>,
) {
  options.companion.setPaused(paused);
  options.controller?.releaseInput();
  const control =
    options.authority?.mode === 'local' ? (paused ? options.authority.pause() : options.authority.resume()) : undefined;
  void control?.catch(() => undefined);
  options.gameplay?.setSuspended(paused);
  options.audio?.updateWorld(
    options.camera,
    options.world,
    options.controller?.onGround ?? false,
    paused,
    options.controller?.waterImmersion,
  );
}

export async function setAuthorityWorldClockPaused(
  environment: WorldEnvironment | null,
  authority: BrowserAuthorityClient | null,
  paused: boolean,
): Promise<void> {
  if (!environment || !authority) return;
  environment.setPaused(paused);
  await authority.setWorldClockRate(paused ? 0 : 0.04 * environment.speed);
}

export async function setAuthorityWorldClockSpeed(
  environment: WorldEnvironment | null,
  authority: BrowserAuthorityClient | null,
  speed: number,
): Promise<void> {
  if (!environment || !authority) return;
  environment.speed = Math.max(0, speed);
  await authority.setWorldClockRate(environment.paused ? 0 : 0.04 * environment.speed);
}

export function requestAuthorityChunk(world: World | null, key: string): void {
  const [cx, cy, cz] = key.split(',').map(Number);
  if ([cx, cy, cz].every(Number.isInteger)) world?.requestChunk(cx, cy, cz);
}

export function reportRuntimeFailure(session: UiWorldSession | null, sequence: number, error: Error): void {
  session?.publishFeedback(sequence, { message: `运行时故障：${error.message}`, tone: 'error', durationMs: 4_000 });
}

export function setMapLayer(uiBridge: UiBridge, layer: MapLayer): void {
  const shell = uiBridge.shell.get();
  if (shell.mapLayer === layer) return;
  uiBridge.publishShell({ mapLayer: layer, mapRevision: shell.mapRevision + 1 });
}

export function toggleMap(
  uiBridge: UiBridge,
  world: Pick<World, 'seed'> | null,
  camera: { getPosition(): { x: number; z: number } } | null,
  controller: { releaseInput(): void } | null,
): void {
  if (!world || !camera) return;
  if (uiBridge.shell.get().mapOpen) {
    uiBridge.publishShell({ mapOpen: false });
    return;
  }
  const position = camera.getPosition();
  controller?.releaseInput();
  const shell = uiBridge.shell.get();
  uiBridge.publishShell({
    mapOpen: true,
    mapSeed: world.seed,
    mapCenter: [position.x, position.z],
    mapRevision: shell.mapRevision + 1,
  });
}

export function publishDebugVisibility(
  uiBridge: UiBridge,
  controller: { releaseInput(): void } | null,
  visible: boolean,
): void {
  if (visible) {
    controller?.releaseInput();
    releasePointerLock();
  }
  uiBridge.publishDebug({ visible });
}

export function toggleCommandShell(uiBridge: UiBridge, controller: { releaseInput(): void } | null): void {
  const open = !uiBridge.shell.get().commandOpen;
  if (open) controller?.releaseInput();
  uiBridge.publishShell({ commandOpen: open });
}

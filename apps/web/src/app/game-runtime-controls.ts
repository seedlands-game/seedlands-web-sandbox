import type { MapLayer } from './ui/ui-contracts';
import type { BrowserAuthorityClient } from '../client/authority/browser-authority-client';
import type { UiBridge, UiWorldSession } from './ui/ui-bridge';
import type { WorldEnvironment } from './scene/world-environment';
import type { World } from './world/world-runtime';

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

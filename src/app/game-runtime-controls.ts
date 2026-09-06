import type { BrowserAuthorityClient } from '../client/browser-authority-client';
import type { UiWorldSession } from './ui/ui-bridge';
import type { WorldEnvironment } from './world-environment';
import type { World } from './world-runtime';

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

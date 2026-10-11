import type { Page } from '@playwright/test';

export type NativeMovementPage = Readonly<{ keyboard: Pick<Page['keyboard'], 'down' | 'up'> }>;

export async function sendNativeMovementPulse(
  page: NativeMovementPage,
  key: 'KeyW' | 'KeyS',
  pulseMs: number,
  jump = false,
): Promise<void> {
  if (!Number.isFinite(pulseMs) || pulseMs < 0) throw new Error('Invalid native movement pulse duration.');
  const keys = jump ? [key, 'Space'] : [key];
  const send = (phase: 'down' | 'up') =>
    Promise.allSettled(keys.map((code) => Promise.resolve().then(() => page.keyboard[phase](code))));
  // Enqueue releases on the pulse deadline, independently of native command ACKs.
  // Stop direction first if native commands queue; the final Space release records neutral input.
  const down = send('down');
  await new Promise<void>((resolve) => setTimeout(resolve, pulseMs));
  const up = send('up');
  const results = (await Promise.all([down, up])).flat();
  const failed = results.find((result) => result.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
}

import type { Page } from '@playwright/test';

export async function sendNativeMovementPulse(
  page: Pick<Page, 'keyboard'>,
  key: 'KeyW' | 'KeyS',
  pulseMs: number,
  jump = false,
): Promise<void> {
  if (!Number.isFinite(pulseMs) || pulseMs < 0) throw new Error('Invalid native movement pulse duration.');
  const keys = jump ? [key, 'Space'] : [key];
  const send = (phase: 'down' | 'up') =>
    Promise.allSettled(
      (phase === 'up' ? [...keys].reverse() : keys).map((code) =>
        Promise.resolve().then(() => page.keyboard[phase](code)),
      ),
    );
  // Enqueue releases on the pulse deadline, independently of native command ACKs.
  // Keep the original jump-before-direction release order for the neutral marker.
  const down = send('down');
  await new Promise<void>((resolve) => setTimeout(resolve, pulseMs));
  const up = send('up');
  const results = (await Promise.all([down, up])).flat();
  const failed = results.find((result) => result.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
}

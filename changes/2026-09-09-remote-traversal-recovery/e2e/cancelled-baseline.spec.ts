import { expect, test } from '@playwright/test';
import { decodeC0Envelope } from '../../../packages/game-core/src/server/protocol/network-c0-codec';
import {
  REMOTE_PLAYABLE_ACCESS_KEY,
  RemotePlayableNodeFixture,
} from '../../2026-09-08-web-node-playable/e2e/remote-playable-node-fixture';

const utf8 = {
  encode: (value: string) => new TextEncoder().encode(value),
  decodeFatal: (value: Uint8Array) => new TextDecoder('utf-8', { fatal: true }).decode(value),
};

test('真实 Node 的分页延迟到同步超时后到达，连接仍存活并重新加载', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const fixture = await RemotePlayableNodeFixture.create(18790, 'node-playable-trial', 'worker-thread');
  let armed = false;
  let target: { requestId: number; bundleId: number; key: string } | null = null;
  let cancelled = false;
  const requestedAt = new Map<number, number>();
  let targetRequestedAt = 0;
  let descriptorAt = 0;
  let heldPageDelayMs = 0;
  let cancelDelayMs = 0;
  let releasedPages = 0;
  const pages: Buffer[] = [];
  const errors: string[] = [];
  const closes: Array<{ code?: number; reason?: string }> = [];
  await page.routeWebSocket(fixture.url, (client) => {
    const server = client.connectToServer();
    client.onMessage((payload) => {
      if (typeof payload !== 'string') {
        const message = decodeC0Envelope(payload, utf8).message;
        if (!target && message.kind === 'interest-update' && typeof message.requestId === 'number') {
          requestedAt.set(message.requestId, Date.now());
          if (requestedAt.size > 128) requestedAt.delete(requestedAt.keys().next().value!);
        }
        if (message.kind === 'interest-cancel' && message.targetRequestId === target?.requestId) {
          cancelled = true;
          cancelDelayMs = Date.now() - targetRequestedAt;
          heldPageDelayMs = Date.now() - descriptorAt;
          for (const page of pages.splice(0)) {
            client.send(page);
            releasedPages += 1;
          }
        }
      }
      server.send(payload);
    });
    server.onMessage((payload) => {
      if (typeof payload !== 'string') {
        const message = decodeC0Envelope(payload, utf8).message;
        if (armed && !target && message.kind === 'baseline-descriptor') {
          target = message.descriptor as typeof target;
          descriptorAt = Date.now();
          targetRequestedAt = requestedAt.get(target!.requestId) ?? 0;
          expect(targetRequestedAt).toBeGreaterThan(0);
          requestedAt.clear();
        }
        if (
          target &&
          !cancelled &&
          message.kind === 'baseline-page' &&
          (message.page as { bundleId: number }).bundleId === target.bundleId
        ) {
          expect(pages.length).toBeLessThan(128);
          pages.push(Buffer.from(payload));
          return;
        }
      }
      client.send(payload);
    });
    server.onClose((code, reason) => {
      closes.push({ code, reason });
      void client.close({ code, reason });
    });
  });
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await fixture.start(`http://127.0.0.1:${process.env.SEEDLANDS_E2E_PORT ?? '4173'}`);
    await page.goto('/?harness=1&performanceProfile=balanced');
    await expect(page.locator('#enter')).toBeEnabled();
    await page.selectOption('#connection-mode', 'remote');
    await page.selectOption('#quality', 'low');
    await page.fill('#node-url', fixture.url);
    await page.locator('input[type="password"]').fill(REMOTE_PLAYABLE_ACCESS_KEY);
    await page.click('#enter');
    await page.waitForFunction(() => Boolean(window.__seedlandsRemoteEvidence), null, { timeout: 30_000 });
    await page.locator('#game').click();
    await expect.poll(() => page.evaluate(() => document.pointerLockElement?.id)).toBe('game');
    await page.mouse.move(640, 360);
    const [yaw, pitch] = await page.evaluate(() => window.__seedlandsRemoteEvidence!.snapshot().viewAngles);
    await page.mouse.move(640 - (225 - yaw) / 0.13, 360 - (-12 - pitch) / 0.13, { steps: 10 });
    armed = true;
    await page.keyboard.down('KeyW');
    await page.keyboard.down('Space');
    await expect.poll(() => target, { timeout: 20_000 }).not.toBeNull();
    await page.keyboard.up('KeyW');
    await page.keyboard.up('Space');
    await expect.poll(() => cancelled, { timeout: 20_000 }).toBe(true);
    expect(releasedPages).toBeGreaterThan(0);
    expect(cancelDelayMs).toBeGreaterThan(14_000);
    await expect
      .poll(
        async () => {
          const key = target!.key.split(',').map(Number);
          return page.evaluate(
            ([cx, cy, cz]) =>
              window.__seedlandsRemoteEvidence?.renderedRevisionAt(cx! * 32, cy! * 32, cz! * 32) ?? null,
            key,
          );
        },
        { timeout: 20_000 },
      )
      .not.toBeNull();
    const tick = await page.evaluate(() => window.__seedlandsRemoteEvidence!.snapshot().physicsTick);
    await expect
      .poll(() => page.evaluate(() => window.__seedlandsRemoteEvidence?.snapshot().physicsTick ?? 0))
      .toBeGreaterThan(tick + 30);
    expect(closes).toEqual([]);
    expect(errors).toEqual([]);
    await testInfo.attach('late-pages', {
      body: JSON.stringify({ target, cancelled, cancelDelayMs, heldPageDelayMs, releasedPages, closes, errors }),
      contentType: 'application/json',
    });
  } finally {
    await page.close();
    await fixture.dispose();
  }
});

import { execFileSync } from 'node:child_process';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { decodeC0Envelope } from '../../../packages/game-core/src/server/protocol/network-c0-codec';
import {
  REMOTE_PLAYABLE_ACCESS_KEY,
  RemotePlayableNodeFixture,
} from '../../2026-09-08-web-node-playable/e2e/remote-playable-node-fixture';

test.use({ viewport: { width: 2560, height: 1359 }, deviceScaleFactor: 2 });

test('持续跨区块移动后近场完整并保留位置对账', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const directory = process.env.SEEDLANDS_TRAVERSAL_OUTPUT ?? '/tmp/seedlands-remote-traversal';
  const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  await mkdir(directory, { recursive: true });
  const fixture = await RemotePlayableNodeFixture.create(18789, 'node-playable-trial', 'worker-thread');
  const samples: unknown[] = [];
  const errors: string[] = [];
  const baselineEvents: Array<{ kind: unknown; requestId: unknown; reason: unknown; key: string | undefined }> = [];
  let unavailableCount = 0;
  page.on('websocket', (socket) =>
    socket.on('framereceived', ({ payload }) => {
      if (typeof payload === 'string') return;
      const utf8 = {
        encode: (text: string) => new TextEncoder().encode(text),
        decodeFatal: (bytes: Uint8Array) => new TextDecoder().decode(bytes),
      };
      const message = decodeC0Envelope(payload, utf8).message;
      if (message.kind === 'baseline-unavailable' || message.kind === 'baseline-descriptor') {
        if (message.kind === 'baseline-unavailable') unavailableCount += 1;
        if (baselineEvents.length < 512)
          baselineEvents.push({
            kind: message.kind,
            requestId: message.requestId,
            reason: message.reason,
            key: (message.descriptor as { key: string } | undefined)?.key,
          });
      }
    }),
  );
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    if (process.env.SEEDLANDS_TRAVERSAL_SNAPSHOT) {
      for (const name of ['CURRENT', 'manifests', 'blobs'])
        await cp(`${process.env.SEEDLANDS_TRAVERSAL_SNAPSHOT}/${name}`, `${fixture.dataDirectory}/${name}`, {
          recursive: true,
        });
    }
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
    const capture = async (stage: string) => {
      const value = await page.evaluate(() => {
        const api = window.__seedlandsRemoteEvidence!;
        const snapshot = api.snapshot();
        const [x, y, z] = snapshot.authoritativePlayer;
        const cx = Math.floor(x / 32),
          cz = Math.floor(z / 32);
        return {
          snapshot,
          prediction: api.prediction(),
          near: Array.from({ length: 9 }, (_, i) => {
            const px = (cx + (i % 3) - 1) * 32,
              pz = (cz + Math.floor(i / 3) - 1) * 32;
            return { key: `${px / 32},0,${pz / 32}`, rendered: api.renderedRevisionAt(px, 0, pz) };
          }),
          trace: api.meshTraceAt(x, y, z),
        };
      });
      samples.push({ stage, ...value });
      console.log(
        stage,
        JSON.stringify({
          position: value.snapshot.authoritativePlayer,
          loaded: value.snapshot.loadedChunks,
          rendered: value.snapshot.renderedChunks,
          resets: value.prediction.resetCounts,
        }),
        JSON.stringify(value.near),
      );
      await writeFile(
        `${directory}/journey.json`,
        JSON.stringify({ sourceSha, samples, errors, baselineEvents, unavailableCount }, null, 2),
      );
      return value;
    };
    let mouseX = 1280,
      mouseY = 679;
    await page.mouse.move(mouseX, mouseY);
    const aim = async (yaw: number, pitch: number) => {
      const [currentYaw, currentPitch] = await page.evaluate(
        () => window.__seedlandsRemoteEvidence!.snapshot().viewAngles,
      );
      mouseX -= (yaw - currentYaw) / 0.13;
      mouseY -= (pitch - currentPitch) / 0.13;
      await page.mouse.move(mouseX, mouseY, { steps: 10 });
    };
    await aim(225, -12);
    const initial = await capture('early');
    await page.screenshot({ path: `${directory}/early.png` });
    await aim(225, -35);
    await expect
      .poll(() => page.evaluate(() => window.__seedlandsRemoteEvidence!.snapshot().aimedVoxel))
      .not.toBeNull();
    const beforeMine = await page.evaluate(() => window.__seedlandsRemoteEvidence!.snapshot().worldRevision);
    await page.mouse.down({ button: 'left' });
    await expect
      .poll(() => page.evaluate(() => window.__seedlandsRemoteEvidence!.snapshot().worldRevision))
      .toBeGreaterThan(beforeMine);
    await page.mouse.up({ button: 'left' });
    await capture('mined');
    await page.waitForTimeout(2_000);
    const start = await capture('walking-start');
    await aim(225, -12);
    await page.keyboard.down('KeyW');
    await page.keyboard.down('Space');
    for (let second = 5; second <= 60; second += 5) {
      await page.waitForTimeout(5_000);
      await capture(`moving-${second}`);
      if (second === 30) await page.screenshot({ path: `${directory}/middle.png` });
    }
    await page.keyboard.up('KeyW');
    await page.keyboard.up('Space');
    const outbound = await capture('outbound-end');
    expect(
      Math.hypot(
        outbound.snapshot.authoritativePlayer[0] - initial.snapshot.authoritativePlayer[0],
        outbound.snapshot.authoritativePlayer[2] - initial.snapshot.authoritativePlayer[2],
      ),
    ).toBeGreaterThan(128);
    await aim(45, -12);
    await page.keyboard.down('KeyW');
    await page.keyboard.down('Space');
    for (let second = 5; second <= 60; second += 5) {
      await page.waitForTimeout(5_000);
      await capture(`returning-${second}`);
    }
    await page.keyboard.up('KeyW');
    await page.keyboard.up('Space');
    await aim(270, -12);
    await page.screenshot({ path: `${directory}/turned.png` });
    await page.waitForTimeout(10_000);
    const final = await capture('settled');
    await page.screenshot({ path: `${directory}/settled.png` });
    expect(errors).toEqual([]);
    expect(unavailableCount).toBe(0);
    expect(final.prediction.resetCounts['collision-history-missing'] ?? 0).toBe(
      start.prediction.resetCounts['collision-history-missing'] ?? 0,
    );
    expect(final.near.filter((chunk) => chunk.rendered === null)).toEqual([]);
  } finally {
    await page.keyboard.up('KeyW').catch(() => undefined);
    await page.close();
    await fixture.stop();
    await writeFile(`${directory}/node.json`, JSON.stringify(fixture.logs(), null, 2));
    await fixture.dispose();
    await testInfo.attach('journey', { path: `${directory}/journey.json`, contentType: 'application/json' });
  }
});

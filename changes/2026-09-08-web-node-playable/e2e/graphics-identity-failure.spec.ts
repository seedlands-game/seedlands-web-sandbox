import { expect, test } from '@playwright/test';
import {
  armGraphicsIdentity,
  captureGraphicsIdentity,
  hasCurrentApplication,
  releaseGraphicsIdentity,
} from './graphics-identity-evidence';
import { selectJourneyQuality } from './journey-quality';
import { RemotePlayableNodeFixture } from './remote-playable-node-fixture';

const port = 18_787;
const origin = `http://127.0.0.1:${process.env.SEEDLANDS_E2E_PORT ?? '4173'}`;

test('错误认证销毁Application后仍保留图形身份', async ({ page }, testInfo) => {
  const node = await RemotePlayableNodeFixture.create(port);
  await node.start(origin);
  try {
    await page.goto('/?harness=1');
    await expect(page.locator('#enter')).toBeEnabled({ timeout: 20_000 });
    await page.selectOption('#connection-mode', 'remote');
    await expect(page.locator('#node-url')).toBeVisible();
    await selectJourneyQuality(page);
    await armGraphicsIdentity(page);
    try {
      await page.fill('#node-url', node.url);
      await page.locator('input[type="password"]').fill('seedlands-e2e-invalid-key');
      await page.click('#enter');
      await expect(page.locator('.start-error')).toBeVisible({ timeout: 10_000 });
      await expect.poll(() => hasCurrentApplication(page)).toBe(false);
      const identity = await captureGraphicsIdentity(page, testInfo, 'authentication-failure', 'connection-failure');
      expect(identity.deviceType).toBe('webgl2');
      expect(identity.renderer).not.toBe('UNAVAILABLE');
    } finally {
      await releaseGraphicsIdentity(page);
    }
  } finally {
    await node.dispose();
  }
});

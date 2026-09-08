import { expect, test } from '@playwright/test';
import { FileGamePersistence } from '../../../apps/node-server/src/node/persistence/file-game-persistence';
import { nodeCorePlatform } from '../../../apps/node-server/src/node/runtime/node-core-platform';
import { GameServer } from '../../../packages/game-core/src/server/game-server';
import { GENERATOR_VERSION } from '../../../packages/game-core/src/world/voxel';
import { decodeC0Envelope } from '../../../packages/game-core/src/server/protocol/network-c0-codec';
import {
  REMOTE_PLAYABLE_ACCESS_KEY,
  RemotePlayableNodeFixture,
} from '../../2026-09-08-web-node-playable/e2e/remote-playable-node-fixture';

const seed = 'remote-melee-integration';
const targetId = 'remote-sword-dummy';
const open = (directory: string) =>
  FileGamePersistence.open({ directory, seedText: seed, generatorVersion: GENERATOR_VERSION });

// 离线造景并关闭存储，运行期只经真实 Web 输入调用公开动作，不提供管理 RPC。
async function prepare(directory: string) {
  const persistence = await open(directory);
  try {
    const server = new GameServer({ platform: nodeCorePlatform, seedText: seed, persistence });
    const edits = [];
    for (let x = -5; x <= 5; x++)
      for (let z = -6; z <= 4; z++) for (let y = 56; y <= 63; y++) edits.push({ x, y, z, value: y === 56 ? 3 : 0 });
    server.editBatch({ actorId: 'offline-fixture', edits });
    server.spawnPlayer({ id: 'player', position: [0.5, 57, 0.5] });
    server.giveItem('player', { itemId: 'wood-sword', count: 1 });
    server.selectHotbarSlot('player', 0);
    server.spawnEntity({ id: targetId, type: 'creature', position: [0.5, 57, -1.9], health: 20, maxHealth: 20 });
    await server.saveFrozen(server.freezeSaveSnapshot(1));
  } finally {
    await persistence.close();
  }
}

test('远端木剑真实输入完成前摇、命中与连击，保存结果由 Node 恢复', async ({ page }, info) => {
  test.setTimeout(90_000);
  const fixture = await RemotePlayableNodeFixture.create(18791, seed, 'worker-thread');
  const errors: string[] = [];
  const receipts: unknown[] = [];
  let closed = false;
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('websocket', (socket) => {
    if (socket.url() !== fixture.url) return;
    socket.on('close', () => (closed = true));
    socket.on('framereceived', ({ payload }) => {
      if (typeof payload === 'string') return;
      const message = decodeC0Envelope(payload, {
        encode: (value) => new TextEncoder().encode(value),
        decodeFatal: (bytes) => new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      }).message;
      if (message.kind === 'action-receipt') receipts.push(message);
    });
  });
  try {
    await prepare(fixture.dataDirectory);
    await fixture.start(`http://127.0.0.1:${process.env.SEEDLANDS_E2E_PORT ?? '4173'}`);
    await page.goto('/?harness=1');
    await expect(page.locator('#enter')).toBeEnabled();
    await page.selectOption('#connection-mode', 'remote');
    await expect(page.getByRole('button', { name: '木剑动作体验场', exact: true })).toHaveCount(0);
    await page.selectOption('#quality', 'low');
    await page.fill('#node-url', fixture.url);
    await page.locator('input[type="password"]').fill(REMOTE_PLAYABLE_ACCESS_KEY);
    await page.click('#enter');
    await page.waitForFunction(() => Boolean(window.__seedlandsRemoteEvidence), null, { timeout: 30_000 });
    await expect(page.getByRole('img', { name: '手持 木剑', exact: true })).toBeAttached();
    await page.locator('#game').click();
    await expect.poll(() => page.evaluate(() => document.pointerLockElement?.id)).toBe('game');
    await page.evaluate(() => {
      const target = window as Window & { __remoteCombatEvidence?: string[] };
      target.__remoteCombatEvidence = [];
      new MutationObserver(() => {
        const text = `${document.querySelector('#combat-status')?.getAttribute('data-phase')} ${document.querySelector('#combat-status')?.textContent} ${document.querySelector('[aria-label="交互反馈"]')?.textContent}`;
        if (target.__remoteCombatEvidence?.at(-1) !== text) target.__remoteCombatEvidence?.push(text);
      }).observe(document.body, { subtree: true, attributes: true, childList: true, characterData: true });
    });
    const combat = () =>
      page.evaluate(() => (window as Window & { __remoteCombatEvidence?: string[] }).__remoteCombatEvidence ?? []);
    const capture = async (name: string) => {
      const path = info.outputPath(`${name}.png`);
      await page.screenshot({ path });
      await info.attach(name, { path, contentType: 'image/png' });
    };
    await capture('remote-sword-ready');
    await page.mouse.down();
    try {
      await expect.poll(async () => (await combat()).some((entry) => entry.startsWith('windup'))).toBe(true);
      await expect.poll(async () => (await combat()).some((entry) => entry.includes('5 点伤害'))).toBe(true);
      await capture('remote-sword-hit');
      await expect.poll(async () => (await combat()).some((entry) => entry.includes('7 点伤害'))).toBe(true);
      await capture('remote-sword-combo');
    } finally {
      await page.mouse.up();
    }
    expect(closed).toBe(false);
    expect(errors).toEqual([]);
    const events = await combat();
    await info.attach('remote-combat', { body: JSON.stringify({ events, receipts }), contentType: 'application/json' });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '保存到 Node 并返回主菜单' }).click();
    await expect(page.locator('#connection-mode')).toBeVisible({ timeout: 20_000 });
    await fixture.stop();
    const persistence = await open(fixture.dataDirectory);
    try {
      const restored = new GameServer({ platform: nodeCorePlatform, seedText: seed, persistence });
      await restored.restore();
      expect(restored.getInventory('player').slots[0]?.itemId).toBe('wood-sword');
      expect(restored.getEntity(targetId)?.health ?? 0).toBeLessThanOrEqual(8);
    } finally {
      await persistence.close();
    }
  } catch (error) {
    console.log(
      'REMOTE_MELEE_FAILURE',
      JSON.stringify({
        errors,
        receipts,
        closed,
        node: fixture.logs(),
        page: await page.locator('body').innerText(),
      }).replaceAll(REMOTE_PLAYABLE_ACCESS_KEY, '[redacted]'),
    );
    throw error;
  } finally {
    await fixture.dispose();
  }
});

import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import type { RemotePlayableEvidence } from '../../../apps/web/src/app/world/remote-playable-evidence';

const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const origin = `http://127.0.0.1:${process.env.SEEDLANDS_E2E_PORT ?? '4173'}`;
const nodePort = 18_787;
const nodeUrl = `ws://127.0.0.1:${nodePort}/seedlands`;
const accessKey = 'seedlands-e2e-synthetic-key';
const evidenceDirectory = resolve('changes/2026-09-08-web-node-playable/evidence');
let dataDirectory = '';
let keyFile = '';
let nodeProcess: ChildProcessWithoutNullStreams | null = null;
let nodeLog: string[] = [];

const evidence = (page: Page) =>
  page.evaluate(() => {
    if (!window.__seedlandsRemoteEvidence) throw new Error('Remote evidence is unavailable.');
    return window.__seedlandsRemoteEvidence.snapshot();
  });

async function waitForOutput(process: ChildProcessWithoutNullStreams, value: string): Promise<void> {
  await new Promise<void>((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error(`Node did not print ${value}.`)), 15_000);
    const inspect = () => {
      if (!nodeLog.some((line) => line.includes(value))) return;
      clearTimeout(timer);
      process.stdout.off('data', inspect);
      resolveReady();
    };
    process.stdout.on('data', inspect);
    process.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Node exited before ready with code ${String(code)}.`));
    });
  });
}

async function startNode(): Promise<void> {
  nodeLog = [];
  nodeProcess = spawn(
    process.execPath,
    [
      'apps/node-server/dist/node-server.js',
      '--data-directory',
      dataDirectory,
      '--seed',
      'mosslight-68',
      '--compute',
      'inline',
      '--listen',
      `127.0.0.1:${nodePort}`,
      '--origin',
      origin,
      '--access-key-file',
      keyFile,
    ],
    { cwd: process.cwd(), stdio: 'pipe' },
  );
  nodeProcess.stdout.on('data', (chunk: Buffer) =>
    nodeLog.push(...chunk.toString('utf8').split(/\r?\n/u).filter(Boolean)),
  );
  nodeProcess.stderr.on('data', (chunk: Buffer) =>
    nodeLog.push(...chunk.toString('utf8').split(/\r?\n/u).filter(Boolean)),
  );
  await waitForOutput(nodeProcess, '"kind":"ready"');
}

async function stopNode(): Promise<readonly string[]> {
  const process = nodeProcess;
  if (!process) return nodeLog;
  nodeProcess = null;
  process.kill('SIGINT');
  await new Promise<void>((resolveExit) => {
    const timer = setTimeout(() => process.kill('SIGKILL'), 10_000);
    process.once('exit', () => {
      clearTimeout(timer);
      resolveExit();
    });
  });
  return nodeLog;
}

async function connect(page: Page): Promise<RemotePlayableEvidence> {
  await page.goto('/?harness=1');
  await expect(page.locator('#enter')).toBeEnabled({ timeout: 20_000 });
  await expect
    .poll(async () => {
      await page.selectOption('#connection-mode', 'remote');
      return page.locator('#node-url').isVisible();
    })
    .toBe(true);
  await page.fill('#node-url', nodeUrl);
  await page.locator('input[type="password"]').fill(accessKey);
  await page.click('#enter');
  await page.waitForFunction(() => Boolean(window.__seedlandsRemoteEvidence), null, { timeout: 30_000 });
  return evidence(page);
}

async function attachFrame(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const path = join(evidenceDirectory, `${name}.png`);
  const body = await page.screenshot({ path });
  await testInfo.attach(name, { body, contentType: 'image/png' });
}

async function alignWithAimedColumn(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const current = await evidence(page);
    if (!current.aimedVoxel) throw new Error('脚下目标在移动对齐期间丢失。');
    const dx = current.aimedVoxel[0] + 0.5 - current.authoritativePlayer[0];
    const dz = current.aimedVoxel[2] + 0.5 - current.authoritativePlayer[2];
    if (Math.hypot(dx, dz) < 0.25) return;
    const yaw = (current.viewAngles[0] * Math.PI) / 180;
    const forward = dx * -Math.sin(yaw) + dz * -Math.cos(yaw);
    const right = dx * Math.cos(yaw) + dz * -Math.sin(yaw);
    const keys = [forward >= 0 ? 'KeyW' : 'KeyS', right >= 0 ? 'KeyD' : 'KeyA'];
    await Promise.all(keys.map((key) => page.keyboard.down(key)));
    await page.waitForTimeout(35);
    await Promise.all(keys.map((key) => page.keyboard.up(key)));
    await page.waitForTimeout(70);
  }
  throw new Error('真实 WASD 未能将玩家对齐到脚下目标格。');
}

async function placeSelectedBlock(
  page: Page,
): Promise<Readonly<{ position: readonly [number, number, number]; voxel: number }>> {
  const directions = [
    [640, 100],
    [800, 140],
    [1_000, 200],
    [1_200, 300],
    [1_270, 500],
    [1_100, 680],
  ] as const;
  for (const [x, y] of directions) {
    await page.mouse.move(x, y, { steps: 5 });
    await page.waitForTimeout(80);
    const current = await evidence(page);
    if (current.aimedAdjacent) {
      const position = current.aimedAdjacent;
      await page.mouse.down({ button: 'right' });
      await page.mouse.up({ button: 'right' });
      await page.waitForTimeout(350);
      if (!(await page.evaluate(() => Boolean(window.__seedlandsRemoteEvidence))))
        throw new Error(`放置后远端会话失败：${await page.locator('.start-error').allTextContents()}`);
      const voxel = await page.evaluate(
        ([vx, vy, vz]) => window.__seedlandsRemoteEvidence!.voxelAt(vx, vy, vz),
        position,
      );
      if (voxel > 0) return { position, voxel };
    }
  }
  throw new Error('真实鼠标环顾与右键未找到可放置格。');
}

test.describe.serial('Web to Node local playable loop', () => {
  test.beforeAll(async () => {
    test.setTimeout(30_000);
    dataDirectory = await mkdtemp(join(tmpdir(), 'seedlands-web-node-playable-'));
    keyFile = join(dataDirectory, 'access-key');
    await writeFile(keyFile, `${accessKey}\n`, { mode: 0o600 });
    await mkdir(evidenceDirectory, { recursive: true });
    await startNode();
  });

  test.afterAll(async () => {
    await stopNode();
  });

  test('真实输入、挖放、关闭重连与Node重启保持权威世界', async ({ context, page }, testInfo) => {
    test.setTimeout(120_000);
    const initial = await connect(page);
    expect(initial.source).toBe('remote-node');
    expect(initial.readyBaselines).toBeGreaterThan(0);
    expect(initial.renderedChunks).toBeGreaterThan(0);
    await page.bringToFront();
    await page.locator('#game').click();
    await expect.poll(() => page.evaluate(() => document.pointerLockElement?.id)).toBe('game');
    await attachFrame(page, testInfo, 'web-node-01-early');

    await page.keyboard.down('KeyW');
    await expect
      .poll(async () => {
        const current = await evidence(page);
        return Math.hypot(
          current.authoritativePlayer[0] - initial.authoritativePlayer[0],
          current.authoritativePlayer[2] - initial.authoritativePlayer[2],
        );
      })
      .toBeGreaterThan(1);
    await attachFrame(page, testInfo, 'web-node-02-moving');
    await page.keyboard.up('KeyW');

    const beforeTurn = await evidence(page);
    await page.mouse.move(640, 360);
    await page.mouse.move(900, 360, { steps: 4 });
    await expect
      .poll(async () => Math.abs((await evidence(page)).viewAngles[0] - beforeTurn.viewAngles[0]))
      .toBeGreaterThan(5);
    await attachFrame(page, testInfo, 'web-node-03-turned');

    await expect.poll(async () => (await evidence(page)).onGround).toBe(true);
    const beforeJump = await evidence(page);
    await page.keyboard.down('Space');
    await expect
      .poll(async () => (await evidence(page)).authoritativePlayer[1])
      .toBeGreaterThan(beforeJump.authoritativePlayer[1] + 0.1);
    await page.keyboard.up('Space');

    await expect.poll(async () => (await evidence(page)).onGround).toBe(true);
    await page.mouse.move(900, 1_100, { steps: 6 });
    await expect.poll(async () => (await evidence(page)).aimedVoxel).not.toBeNull();
    await alignWithAimedColumn(page);
    const beforeBreak = await evidence(page);
    const minedVoxel = beforeBreak.aimedVoxel!;
    expect(beforeBreak.aimedVoxelType).toBeGreaterThan(0);
    expect(
      Math.hypot(
        minedVoxel[0] + 0.5 - beforeBreak.authoritativePlayer[0],
        minedVoxel[1] + 0.5 - beforeBreak.authoritativePlayer[1],
        minedVoxel[2] + 0.5 - beforeBreak.authoritativePlayer[2],
      ),
    ).toBeLessThan(2.5);
    await page.mouse.down({ button: 'left' });
    try {
      await expect.poll(async () => (await evidence(page)).breakActionPosition).toEqual(minedVoxel);
      await expect
        .poll(() => page.evaluate(([x, y, z]) => window.__seedlandsRemoteEvidence!.voxelAt(x, y, z), minedVoxel), {
          timeout: 15_000,
        })
        .toBe(0);
    } finally {
      await page.mouse.up({ button: 'left' });
    }
    const afterBreak = await evidence(page);
    await expect.poll(async () => page.locator('#hotbar button[data-item$="-block"]').count()).toBeGreaterThan(0);
    const occupiedSlot = await page
      .locator('#hotbar button')
      .evaluateAll((slots) => slots.findIndex((slot) => slot.getAttribute('data-item')?.endsWith('-block')));
    expect(occupiedSlot).toBeGreaterThanOrEqual(0);
    await page.keyboard.press(`Digit${occupiedSlot + 1}`);
    await expect.poll(async () => (await evidence(page)).selectedSlot).toBe(occupiedSlot);
    await expect.poll(async () => (await evidence(page)).selectedItem).toMatch(/-block$/u);
    const placement = await placeSelectedBlock(page);
    const placedVoxel = placement.position;
    const placedVoxelType = placement.voxel;
    const placedChunkRevision = await page.evaluate(
      ([x, y, z]) => window.__seedlandsRemoteEvidence!.chunkRevisionAt(x, y, z),
      placedVoxel,
    );
    expect(placedChunkRevision).not.toBeNull();
    await expect
      .poll(() =>
        page.evaluate(([x, y, z]) => window.__seedlandsRemoteEvidence!.renderedRevisionAt(x, y, z), placedVoxel),
      )
      .toBe(placedChunkRevision);
    const afterPlace = await evidence(page);
    await attachFrame(page, testInfo, 'web-node-04-placed');

    await page.keyboard.press('Escape');
    const pauseDialog = page.getByRole('dialog', { name: '暂停游戏' });
    await expect(pauseDialog).toBeVisible();
    await expect(page.getByText('菜单期间 Node 世界仍在继续')).toBeVisible();
    await expect(pauseDialog.locator('[data-remote-server-info]')).toContainText(nodeUrl);
    await expect(pauseDialog.locator('[data-remote-server-info]')).toContainText('mosslight-68');
    await page.getByRole('button', { name: '保存到 Node 并返回主菜单' }).click();
    await expect(page.locator('#connection-mode')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('#start-card [data-remote-server-info]')).toContainText('mosslight-68');

    const tickBeforeClose = afterPlace.physicsTick;
    const oldServerEpoch = afterPlace.serverEpoch;
    await page.close();
    await new Promise((resolveWait) => setTimeout(resolveWait, 1_200));
    const reconnectPage = await context.newPage();
    const reconnected = await connect(reconnectPage);
    expect(reconnected.serverEpoch).toBe(oldServerEpoch);
    expect(reconnected.physicsTick).toBeGreaterThan(tickBeforeClose + 15);
    await expect
      .poll(() =>
        reconnectPage.evaluate(([x, y, z]) => window.__seedlandsRemoteEvidence!.voxelAt(x, y, z), placedVoxel),
      )
      .toBe(placedVoxelType);

    const stoppedLog = await stopNode();
    expect(stoppedLog.some((line) => line.includes('"kind":"stopped"'))).toBe(true);
    await startNode();
    await reconnectPage.close();
    const restartedPage = await context.newPage();
    const restarted = await connect(restartedPage);
    expect(restarted.serverEpoch).not.toBe(oldServerEpoch);
    await expect
      .poll(() =>
        restartedPage.evaluate(([x, y, z]) => window.__seedlandsRemoteEvidence!.voxelAt(x, y, z), placedVoxel),
      )
      .toBe(placedVoxelType);
    await attachFrame(restartedPage, testInfo, 'web-node-05-restarted');

    await writeFile(
      join(evidenceDirectory, 'web-node-playable-run.json'),
      `${JSON.stringify(
        {
          sourceSha,
          initial,
          beforeBreak,
          afterBreak,
          placedVoxel,
          placedVoxelType,
          afterPlace,
          reconnected,
          restarted,
          nodeLog,
        },
        null,
        2,
      )}\n`,
    );
  });
});

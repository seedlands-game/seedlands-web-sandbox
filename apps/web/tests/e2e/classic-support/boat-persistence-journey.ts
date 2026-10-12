import { expect, type Page, type TestInfo } from '@playwright/test';
import { snapshot, type ClassicWindow } from './harness';
import { confirmClassicPerformanceWarning } from './start';

const transport = (page: Page) =>
  page.evaluate(() => (window as unknown as ClassicWindow).__seedlandsHarness!.transportSnapshot());

/** Save through the native menu; reopening must retain the boat state and retire its old reference. */
export async function saveAndReopenBoat(page: Page, seed: string, info: TestInfo) {
  await page.keyboard.press('Escape');
  const pause = page.getByRole('button', { name: '暂停游戏', exact: true });
  if (await pause.isVisible()) await pause.click();
  await expect.poll(async () => (await snapshot(page))?.authority.paused).toBe(true);
  const saved = (await transport(page))!.transports[0]!;
  expect(saved.rider).toBeNull();
  const savedIdentity = await page.evaluate(() =>
    (window as unknown as ClassicWindow).__seedlandsHarness!.world.identity(),
  );
  if (!savedIdentity.ok) throw Error(savedIdentity.error.message);
  await page.getByRole('button', { name: '保存并返回主菜单', exact: true }).click();
  await page.locator('#start-card').waitFor({ state: 'visible' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('#seed').fill(seed);
  await page.getByRole('button', { name: '进入世界', exact: true }).click();
  await confirmClassicPerformanceWarning(page);
  await page.locator('#start-card').waitFor({ state: 'hidden' });
  await expect
    .poll(async () => (await transport(page))?.transports[0]?.reference)
    .toEqual({ ...saved.reference, epoch: saved.reference.epoch + 1 });
  const restored = (await transport(page))!.transports[0]!;
  const terrain = await page.evaluate(async () => {
    const world = (window as unknown as ClassicWindow).__seedlandsHarness!.world;
    return Promise.all(
      [1, 2, 3, 4].flatMap((x) =>
        [-1, 0, 1].map(async (z) => ({
          position: [x, 31, z],
          inspection: await world.inspect({ kind: 'voxel', position: [x, 31, z] }),
        })),
      ),
    );
  });
  await info.attach('boat-save-reopen-state.json', {
    body: Buffer.from(JSON.stringify({ saved, restored, savedIdentity, terrain, snapshot: await snapshot(page) })),
    contentType: 'application/json',
  });
  expect(restored.definitionId).toBe(saved.definitionId);
  expect(restored.pose.yaw).toBe(saved.pose.yaw);
  expect(restored.pose.position[1]).toBe(saved.pose.position[1]);
  expect(restored.routeCursor).toEqual(saved.routeCursor);
  expect(restored.rider).toBeNull();
  expect(restored.fuel).toEqual(saved.fuel);
  expect(restored.inventory).toEqual(saved.inventory);

  // Saved rest must remain exact; any saved momentum can coast by at most v/drag.
  const speed = Math.hypot(saved.velocity[0], saved.velocity[2]);
  const dx = restored.pose.position[0] - saved.pose.position[0];
  const dz = restored.pose.position[2] - saved.pose.position[2];
  expect(dx * saved.velocity[0] + dz * saved.velocity[2]).toBeGreaterThanOrEqual(-1e-9);
  expect(Math.abs(dx * saved.velocity[2] - dz * saved.velocity[0])).toBeLessThan(1e-6);
  expect(Math.hypot(dx, dz)).toBeLessThanOrEqual(speed / 0.8 + 1e-6);
  const restoredSpeed = Math.hypot(restored.velocity[0], restored.velocity[2]);
  expect(restoredSpeed).toBeLessThanOrEqual(speed + 1e-9);
  if (speed === 0) {
    expect(restored.pose).toEqual(saved.pose);
    expect(restored.velocity).toEqual(saved.velocity);
  } else {
    expect(restoredSpeed).toBeGreaterThan(0);
    expect(restored.velocity[0] * saved.velocity[0] + restored.velocity[2] * saved.velocity[2]).toBeGreaterThan(0);
  }

  const [stale, current, identity] = await page.evaluate(
    async ({ oldReference, newReference }) => {
      const world = (window as unknown as ClassicWindow).__seedlandsHarness!.world;
      return Promise.all([
        world.inspect({ kind: 'entity-reference', reference: oldReference }),
        world.inspect({ kind: 'entity-reference', reference: newReference }),
        world.identity(),
      ]);
    },
    { oldReference: saved.reference, newReference: restored.reference },
  );
  expect(stale).toMatchObject({
    ok: true,
    data: { kind: 'entity-reference', reference: saved.reference, status: 'stale' },
  });
  expect(current).toMatchObject({
    ok: true,
    data: { kind: 'entity-reference', reference: restored.reference, status: 'current' },
  });
  if (!stale.ok) throw Error(stale.error.message);
  if (!current.ok) throw Error(current.error.message);
  if (!identity.ok) throw Error(identity.error.message);
  expect(identity.data.worldId).toBe(savedIdentity.data.worldId);
  expect(identity.data.seedText).toBe(seed);
  expect(identity.data.generatorVersion).toBe(savedIdentity.data.generatorVersion);
  expect(typeof identity.data.epoch).toBe('string');
  expect(stale.frontier?.epoch).toBe(identity.data.epoch);
  expect(current.frontier?.epoch).toBe(identity.data.epoch);
  return { saved, restored, savedIdentity, stale, current, identity, coastDistance: Math.hypot(dx, dz) };
}

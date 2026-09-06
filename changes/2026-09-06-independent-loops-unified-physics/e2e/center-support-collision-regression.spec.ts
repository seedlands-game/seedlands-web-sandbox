import { expect, test } from '@playwright/test';
import {
  lockPointer,
  snapshot,
  startHarnessWorld,
  waitForPlayerMovement,
  waitForSnapshot,
} from '../../../tests/e2e/support/harness';

type AuthoritySnapshot = NonNullable<Awaited<ReturnType<typeof snapshot>>> & {
  authority: { physicsTick: number };
};

const currentSnapshot = (page: Parameters<typeof snapshot>[0]) => snapshot(page) as Promise<AuthoritySnapshot | null>;

test('挖除全部真实支撑后下落与空中 Space 都不产生身体重叠', async ({ page }, testInfo) => {
  await startHarnessWorld(page, 'seedlands-player-collision');
  await page.evaluate(async () => await window.__seedlandsHarness!.prepareCenterExcavation());
  const supported = await waitForSnapshot(
    page,
    (current) =>
      current.onGround &&
      !current.colliding &&
      Math.abs(current.player[1] - 58.6) < 0.001 &&
      Math.abs(current.serverPlayerPosition[1] - 58.6) < 0.001,
  );
  await expect
    .poll(async () => (await currentSnapshot(page))!.authority.physicsTick)
    .toBeGreaterThan((supported as AuthoritySnapshot).authority.physicsTick + 15);
  await page.evaluate(async () =>
    window.__seedlandsHarness!.fillWorld({ from: [-1, 56, -1], to: [0, 56, 0], voxel: 0 }),
  );
  const falling = await waitForPlayerMovement(page, {
    axis: 1,
    start: supported.player[1],
    minimumDelta: 0.25,
    direction: -1,
  });
  await lockPointer(page);
  await page.keyboard.down('Space');
  try {
    const afterSpace = await waitForPlayerMovement(page, {
      axis: 1,
      start: falling.player[1],
      minimumDelta: 0.15,
      direction: -1,
    });
    const removedSupport = await page.evaluate(() => {
      const supportCoordinates = [
        [-1, 56, -1],
        [-1, 56, 0],
        [0, 56, -1],
        [0, 56, 0],
      ] as const;
      return supportCoordinates.map(([x, y, z]) => window.__seedlandsHarness!.getVoxelAt?.(x, y, z));
    });
    await testInfo.attach('center-support-fall-snapshots', {
      body: JSON.stringify(
        {
          supported: {
            player: supported.player,
            serverPlayerPosition: supported.serverPlayerPosition,
            physicsTick: (supported as AuthoritySnapshot).authority.physicsTick,
          },
          falling: {
            player: falling.player,
            serverPlayerPosition: falling.serverPlayerPosition,
            onGround: falling.onGround,
            colliding: falling.colliding,
          },
          afterSpace: {
            player: afterSpace.player,
            serverPlayerPosition: afterSpace.serverPlayerPosition,
            onGround: afterSpace.onGround,
            colliding: afterSpace.colliding,
          },
          removedSupport,
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });
    expect(removedSupport).toEqual([0, 0, 0, 0]);
    expect(falling.colliding).toBe(false);
    expect(afterSpace.onGround).toBe(false);
    expect(afterSpace.colliding).toBe(false);
  } finally {
    await page.keyboard.up('Space');
  }
});

import { expect, test } from '@playwright/test';
import { waitForPlayerMovement, waitForSnapshot } from '../../../tests/e2e/support/harness';

async function installChangingHarness(page: import('@playwright/test').Page, matching: object, later: object) {
  await page.setContent('<main>snapshot observation fixture</main>');
  await page.evaluate(
    ([first, subsequent]) => {
      let observations = 0;
      Object.assign(window, {
        __seedlandsHarness: {
          snapshot: () => (observations++ === 0 ? first : subsequent),
        },
      });
    },
    [matching, later],
  );
}

test('waitForSnapshot returns the browser observation that matched its predicate', async ({ page }) => {
  await installChangingHarness(
    page,
    { player: [0, 58.6, 0], onGround: true, colliding: false },
    { player: [0, 57.6, 0], onGround: false, colliding: true },
  );

  const matching = await waitForSnapshot(page, (current) => current.onGround && !current.colliding);

  expect(matching).toMatchObject({ onGround: true, colliding: false, player: [0, 58.6, 0] });
});

test('waitForPlayerMovement returns the browser observation that matched movement and height', async ({ page }) => {
  await installChangingHarness(
    page,
    { player: [0, 58.6, 1.5], onGround: true, colliding: false },
    { player: [0, 57.6, 0], onGround: false, colliding: true },
  );

  const matching = await waitForPlayerMovement(page, {
    axis: 2,
    start: 0,
    minimumDelta: 1,
    direction: 1,
    yTarget: 58.6,
    yTolerance: 0.001,
  });

  expect(matching).toMatchObject({ onGround: true, colliding: false, player: [0, 58.6, 1.5] });
});

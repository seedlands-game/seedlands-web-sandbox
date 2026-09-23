import { expect, type Page } from '@playwright/test';
import type { ClassicWindow } from './harness';

export async function expectPresentedDropOrPickup(page: Page, itemId: string, countBefore: number): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          async ({ itemId, countBefore }) => {
            const harness = (window as unknown as ClassicWindow).__seedlandsHarness!;
            const [nearby, playerState] = await Promise.all([
              harness.world.command({ type: 'query-nearby', radius: 8 }),
              harness.world.command({ type: 'query-player-state' }),
            ]);
            if (!nearby.ok) throw new Error(nearby.error.message);
            if (!playerState.ok) throw new Error(playerState.error.message);
            const payload = nearby.data as {
              success: boolean;
              data?: { entities: { id: string; type: string; stack?: { itemId: string } }[] };
            };
            if (!payload.success) throw new Error('Nearby drop query failed');
            const inventory =
              (
                playerState.data as {
                  data?: { player?: { inventory?: Array<{ itemId: string; count: number } | null> } };
                }
              ).data?.player?.inventory ?? [];
            if (inventory.reduce((total, item) => total + (item?.itemId === itemId ? item.count : 0), 0) > countBefore)
              return true;
            return (
              payload.data?.entities.some(
                (entity) =>
                  entity.type === 'world-item' &&
                  entity.stack?.itemId === itemId &&
                  harness.presentedEntityPosition(entity.id) !== null,
              ) ?? false
            );
          },
          { itemId, countBefore },
        ),
      { timeout: 5000 },
    )
    .toBe(true);
}

import { expect, type Page } from '@playwright/test';
import type { ClassicWindow } from './harness';

export async function expectPresentedDrop(page: Page, itemId: string): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(async (itemId) => {
          const harness = (window as unknown as ClassicWindow).__seedlandsHarness!;
          const result = await harness.world.command({ type: 'query-nearby', radius: 8 });
          if (!result.ok) throw new Error(result.error.message);
          const payload = result.data as {
            success: boolean;
            data?: { entities: { id: string; type: string; stack?: { itemId: string } }[] };
          };
          if (!payload.success) throw new Error('Nearby drop query failed');
          return (
            payload.data?.entities.some(
              (entity) =>
                entity.type === 'world-item' &&
                entity.stack?.itemId === itemId &&
                harness.presentedEntityPosition(entity.id) !== null,
            ) ?? false
          );
        }, itemId),
      { timeout: 5000 },
    )
    .toBe(true);
}

import type { Page } from '@playwright/test';
import type { ClassicWindow } from './harness';

export async function clearNaturalFixtureEntities(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const harness = (window as unknown as ClassicWindow).__seedlandsHarness;
    if (!harness) throw new Error('Classic Harness is unavailable.');
    const unwrap = <T>(result: Awaited<ReturnType<typeof harness.world.command>>, operation: string): T => {
      if (!result.ok) throw new Error(operation + ': ' + result.error.code + ': ' + result.error.message);
      return result.data as T;
    };
    const clock = async (kind: 'pause' | 'run') => {
      const result = await harness.world.clock({ kind });
      if (!result.ok) throw new Error(kind + ': ' + result.error.code + ': ' + result.error.message);
    };
    await clock('pause');
    try {
      const query = async () => {
        const nearby = unwrap<{ data?: { entities?: Array<{ id: string }> } }>(
          await harness.world.command({ type: 'query-nearby', radius: 512 }),
          'query fixture entities',
        );
        return (nearby.data?.entities ?? []).filter(({ id }) => id.startsWith('natural-'));
      };
      const unexpected = await query();
      for (const entity of unexpected)
        unwrap(
          await harness.world.command({ type: 'despawn-entity', entityId: entity.id }),
          'despawn unexpected fixture entity ' + entity.id,
        );
      const remaining = await query();
      if (remaining.length)
        throw new Error('Unexpected Classic fixture entities remain: ' + remaining.map(({ id }) => id).join(', '));
      return unexpected.map(({ id }) => id);
    } finally {
      await clock('run');
    }
  });
}

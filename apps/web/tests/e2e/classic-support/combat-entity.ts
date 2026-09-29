import type { Page } from '@playwright/test';

export type EntityProjection = Readonly<{ id: string; health: number }>;

export const queryEntity = (page: Page, entityId: string): Promise<EntityProjection | null> =>
  page.evaluate(async (entityId) => {
    const harness = (
      window as Window & {
        __seedlandsHarness?: {
          world: {
            command(command: Record<string, unknown>): Promise<{ ok: boolean; data?: unknown; error?: unknown }>;
          };
        };
      }
    ).__seedlandsHarness;
    if (!harness) throw new Error('Classic Harness is unavailable.');
    const result = await harness.world.command({ type: 'query-entity', entityId });
    if (!result.ok) throw new Error(`Entity query failed: ${JSON.stringify(result.error)}`);
    const payload = result.data as { success?: boolean; data?: { entity?: EntityProjection | null } };
    if (!payload.success) throw new Error('Entity query failed.');
    return payload.data?.entity ?? null;
  }, entityId);

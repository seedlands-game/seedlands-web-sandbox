import type { Page } from '@playwright/test';

/** Product camera only: keep the actual Authority-owned body in the evidence frame. */
export async function faceCompanion(page: Page, entityId?: string): Promise<void> {
  await page.evaluate(async (id) => {
    const harness = window.__seedlandsHarness!;
    const world = harness.world;
    if (!id) {
      const list = await world.character({ kind: 'list' });
      if (!list.ok || list.data.kind !== 'list') throw new Error('Character list unavailable');
      id = list.data.characters[0]?.entityId;
    }
    if (!id) throw new Error('Character unavailable');
    const observed = await world.character({ kind: 'observe', entityId: id });
    const state = harness.snapshot();
    if (!observed.ok || observed.data.kind !== 'observation' || !state) throw new Error('Body unavailable');
    const [x, y, z] = observed.data.observation.self.position;
    const dx = x - state.player[0];
    const dy = y + 1 - state.player[1];
    const dz = z - state.player[2];
    harness.setView((Math.atan2(-dx, -dz) * 180) / Math.PI, (Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI);
  }, entityId);
}

/** A floor large enough for two real bodies and a walking forage target. */
export async function prepareCompanionGround(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const world = window.__seedlandsHarness!.world;
    for (const command of [
      { type: 'fill' as const, from: [-8, 56, -12] as const, to: [8, 56, 8] as const, voxel: 3 },
      { type: 'fill' as const, from: [-8, 57, -12] as const, to: [8, 61, 8] as const, voxel: 0 },
    ]) {
      const result = await world.command(command);
      if (!result.ok || !result.data.success) throw new Error(`Companion ground failed: ${JSON.stringify(result)}`);
    }
  });
}

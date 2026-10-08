import type { Page } from '@playwright/test';
import { describe, expect, it } from 'vitest';
import { lockPointer, moveMouseBy } from './mouse-input';
import { correctMouseToRoute } from './target-aim';
import { walkTo } from './harness';

const BROWSER08_PLAYER = [Number('78.67385864257812'), 32.6, Number('-0.6099324226379395')] as const;

function mousePage() {
  let yaw = -57.5;
  let elapsed = 0;
  let moves = 0;
  let currentX = 50_000;
  let arrived = false;
  let downs = 0;
  let pointerLocked = false;
  const page = {
    locator: () => ({
      isVisible: async () => false,
      boundingBox: async () => ({ x: 0, y: 0, width: 100_000, height: 10_000 }),
      click: async () => {
        pointerLocked = true;
      },
    }),
    waitForFunction: async () => undefined,
    mouse: {
      move: async (x: number) => {
        yaw -= (x - currentX) * 0.13;
        currentX = x;
        moves += 1;
      },
    },
    keyboard: {
      down: async () => {
        arrived = true;
        downs += 1;
      },
      up: async () => undefined,
    },
    evaluate: async (callback: () => unknown) => {
      if (String(callback).includes('pointerLockElement')) return pointerLocked;
      if (String(callback).includes('snapshot()')) {
        const player = arrived ? [78.5, 32.6, -0.5] : BROWSER08_PLAYER;
        return {
          player,
          serverPlayerPosition: player,
          serverPlayerVelocity: [0, 0, 0],
          viewAngles: [yaw, -29.39],
          onGround: true,
          colliding: false,
          authority: { acknowledgedInputSequence: arrived ? 2 : 1 },
        };
      }
      if (String(callback).includes('requestAnimationFrame')) elapsed += 1_600;
    },
  } as unknown as Page;
  return { page, yaw: () => yaw, elapsed: () => elapsed, moves: () => moves, downs: () => downs };
}

describe('route mouse input observes synchronous yaw without a render dependency', () => {
  it('Browser08 reverse turn retains 18-move bound despite slow renderer', async () => {
    const driver = mousePage();
    await lockPointer(driver.page);
    const result = await correctMouseToRoute({
      target: [78.5, -0.5],
      direction: 'KeyW',
      observe: async () => ({
        player: BROWSER08_PLAYER,
        viewAngles: [driver.yaw(), -29.39],
      }),
      move: async (dx, dy) => {
        // Route reads yaw from the actual event handler, independent of rendering.
        await moveMouseBy(driver.page, dx, dy, { waitForRender: false });
      },
    });
    expect(result.kind).toBe('angle-aligned');
    expect(driver.moves()).toBeLessThanOrEqual(18);
    expect(driver.elapsed()).toBe(0);
  });
  it.each([false, true])(
    'walkTo refresh=%s uses event-confirmed turning and retains settled arrival',
    async (refreshAfterCorrection) => {
      const driver = mousePage();
      await lockPointer(driver.page);
      const result = await walkTo(driver.page, [78.5, -0.5], {
        refreshAfterCorrection,
        tolerance: 0.06,
        corridorTolerance: 0.08,
        pulseMs: 80,
      });
      expect(result.player).toEqual([78.5, 32.6, -0.5]);
      expect(driver.moves()).toBeLessThanOrEqual(18);
      expect(driver.downs()).toBe(1);
      expect(driver.elapsed()).toBe(0);
    },
  );
  it('default voxel and visual movement retains the existing two-frame wait', async () => {
    const driver = mousePage();
    await lockPointer(driver.page);
    await moveMouseBy(driver.page, -80, 0);
    expect(driver.elapsed()).toBe(1_600);
  });
});

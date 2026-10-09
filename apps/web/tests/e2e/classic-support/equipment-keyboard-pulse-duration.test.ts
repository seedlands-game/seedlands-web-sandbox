import { describe, expect, it, vi } from 'vitest';
import { walkEquipmentRoute } from './equipment-journey-support';
import { lockPointer } from './mouse-input';
import {
  EQUIPMENT_ROUTE_NEAR_START,
  EQUIPMENT_ROUTE_TARGET,
  makeEquipmentRoutePhysicsModel,
  pumpUntilSettled,
} from './equipment-route-physics-fixture';

describe('Classic V2 near-route keyboard pulse duration', () => {
  it('holds movement for at most the 80ms pulse despite a slow keyboard API reply', async () => {
    vi.useFakeTimers();
    const model = makeEquipmentRoutePhysicsModel(EQUIPMENT_ROUTE_NEAR_START, { keyboardReplyDelayMs: 1000 });
    const baseline = model.snapshot();
    try {
      await lockPointer(model.page);
      let result: Awaited<ReturnType<typeof walkEquipmentRoute>> | null = null;
      let routeError: unknown;
      try {
        result = await pumpUntilSettled(walkEquipmentRoute(model.page, EQUIPMENT_ROUTE_TARGET), 60_000);
      } catch (error) {
        routeError = error;
      }

      expect(model.keyDowns.length).toBeGreaterThan(0);
      expect(model.keyUps).toEqual(model.keyDowns);
      expect(
        model.pulseDurations.every((duration) => duration <= 80),
        JSON.stringify({
          firstDurations: model.pulseDurations.slice(0, 4),
          firstPulseEndPositions: model.pulseEndPositions.slice(0, 4),
          routeError: String(routeError),
        }),
      ).toBe(true);
      if (routeError) throw routeError;
      expect(result).not.toBeNull();
      const settled = result!;
      expect(model.pulseEndPositions[0]![0]).toBeGreaterThan(EQUIPMENT_ROUTE_TARGET[0]);
      expect(
        Math.hypot(settled.player[0] - EQUIPMENT_ROUTE_TARGET[0], settled.player[2] - EQUIPMENT_ROUTE_TARGET[1]),
      ).toBeLessThan(0.06);
      expect(
        Math.hypot(
          settled.serverPlayerPosition[0] - EQUIPMENT_ROUTE_TARGET[0],
          settled.serverPlayerPosition[2] - EQUIPMENT_ROUTE_TARGET[1],
        ),
      ).toBeLessThan(0.06);
      expect(settled.onGround).toBe(true);
      expect(settled.colliding).toBe(false);
      expect(settled.serverPlayerVelocity).toEqual([0, 0, 0]);
      expect(settled.authority.physicsTick).toBeGreaterThan(baseline.authority.physicsTick);
      expect(settled.authority.acknowledgedInputSequence).toBeGreaterThan(baseline.authority.acknowledgedInputSequence);
    } finally {
      model.dispose();
      vi.useRealTimers();
    }
  }, 90_000);
});

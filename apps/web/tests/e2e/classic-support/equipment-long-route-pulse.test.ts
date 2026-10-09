import { describe, expect, it, vi } from 'vitest';
import { walkEquipmentRoute } from './equipment-journey-support';
import { lockPointer } from './mouse-input';
import {
  EQUIPMENT_ROUTE_LONG_START,
  EQUIPMENT_ROUTE_NEAR_START,
  EQUIPMENT_ROUTE_TARGET,
  makeEquipmentRoutePhysicsModel,
  pumpUntilSettled,
} from './equipment-route-physics-fixture';

describe('Classic V2 long equipment-route pulse selection', () => {
  it('finishes the 20m clear-corridor return with fresh settled physics observations inside the original deadline', async () => {
    vi.useFakeTimers();
    const model = makeEquipmentRoutePhysicsModel(EQUIPMENT_ROUTE_LONG_START);
    try {
      await lockPointer(model.page);
      const route = walkEquipmentRoute(model.page, EQUIPMENT_ROUTE_TARGET);
      const result = await pumpUntilSettled(route, 60_000);

      expect(model.keyDowns.length).toBeGreaterThan(0);
      expect(model.keyUps).toEqual(model.keyDowns);
      expect(model.pulseDurations.some((duration) => duration > 80)).toBe(true);
      expect(
        Math.hypot(result.player[0] - EQUIPMENT_ROUTE_TARGET[0], result.player[2] - EQUIPMENT_ROUTE_TARGET[1]),
      ).toBeLessThan(0.06);
      expect(
        Math.hypot(
          result.serverPlayerPosition[0] - EQUIPMENT_ROUTE_TARGET[0],
          result.serverPlayerPosition[2] - EQUIPMENT_ROUTE_TARGET[1],
        ),
      ).toBeLessThan(0.06);
      expect(result.onGround).toBe(true);
      expect(result.colliding).toBe(false);
      expect(result.authority.physicsTick).toBeGreaterThan(0);
      expect(result.authority.acknowledgedInputSequence).toBeGreaterThan(100);
      expect(result.serverPlayerVelocity).toEqual([0, 0, 0]);
    } finally {
      model.dispose();
      vi.useRealTimers();
    }
  }, 120_000);

  it('keeps the existing short pulse for an already-near approach', async () => {
    vi.useFakeTimers();
    const model = makeEquipmentRoutePhysicsModel(EQUIPMENT_ROUTE_NEAR_START);
    try {
      await lockPointer(model.page);
      const result = await pumpUntilSettled(walkEquipmentRoute(model.page, EQUIPMENT_ROUTE_TARGET), 20_000);
      expect(model.pulseDurations.length).toBeGreaterThan(0);
      expect(model.pulseDurations.every((duration) => duration <= 80)).toBe(true);
      expect(
        Math.hypot(result.player[0] - EQUIPMENT_ROUTE_TARGET[0], result.player[2] - EQUIPMENT_ROUTE_TARGET[1]),
      ).toBeLessThan(0.06);
      expect(
        Math.hypot(
          result.serverPlayerPosition[0] - EQUIPMENT_ROUTE_TARGET[0],
          result.serverPlayerPosition[2] - EQUIPMENT_ROUTE_TARGET[1],
        ),
      ).toBeLessThan(0.06);
      expect(result.onGround).toBe(true);
      expect(result.colliding).toBe(false);
    } finally {
      model.dispose();
      vi.useRealTimers();
    }
  }, 60_000);
});

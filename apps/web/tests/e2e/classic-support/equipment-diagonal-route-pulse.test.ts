import { expect, it, vi } from 'vitest';
import { walkEquipmentRoute } from './equipment-journey-support';
import { lockPointer } from './mouse-input';
import { makeEquipmentRoutePhysicsModel, pumpUntilSettled } from './equipment-route-physics-fixture';

const DIAGONAL_START = [98.5, 32.6, 0.5] as const;
const TARGET = [78.5, -0.5] as const;

it('settles a long diagonal return using actual route input pulses', async () => {
  vi.useFakeTimers();
  const model = makeEquipmentRoutePhysicsModel(DIAGONAL_START);
  try {
    await lockPointer(model.page);
    const result = await pumpUntilSettled(walkEquipmentRoute(model.page, TARGET), 60_000);

    expect(model.keyDowns.length).toBeGreaterThan(0);
    expect(model.keyUps).toEqual(model.keyDowns);
    expect(model.pulseDurations.some((duration) => duration > 80)).toBe(true);
    expect(Math.hypot(result.player[0] - TARGET[0], result.player[2] - TARGET[1])).toBeLessThan(0.06);
    expect(
      Math.hypot(result.serverPlayerPosition[0] - TARGET[0], result.serverPlayerPosition[2] - TARGET[1]),
    ).toBeLessThan(0.06);
    expect(result.onGround).toBe(true);
    expect(result.colliding).toBe(false);
    expect(result.serverPlayerVelocity).toEqual([0, 0, 0]);
    expect(result.authority.physicsTick).toBeGreaterThan(0);
    expect(result.authority.acknowledgedInputSequence).toBeGreaterThan(100);
  } finally {
    model.dispose();
    vi.useRealTimers();
  }
}, 120_000);

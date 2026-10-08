import { describe, expect, it } from 'vitest';
import { reachedRouteTarget, routeInputSettled } from './route-progress';

describe('Classic real-input route progress', () => {
  it('does not finish a released pulse while Authority still moves or presentation is stale', () => {
    const observation = {
      player: [41.546707, 32.6, 0.500499] as const,
      serverPlayerPosition: [40.796717, 32.6, 0.500499] as const,
      serverPlayerVelocity: [-4.5, 0, 0] as const,
    };
    expect(routeInputSettled(observation)).toBe(false);
    expect(routeInputSettled({ ...observation, serverPlayerVelocity: [0, 0, 0] })).toBe(false);
    expect(
      routeInputSettled({
        ...observation,
        player: observation.serverPlayerPosition,
        serverPlayerVelocity: [0, 0, 0],
      }),
    ).toBe(true);
    expect(
      routeInputSettled({
        ...observation,
        player: observation.serverPlayerPosition,
        serverPlayerVelocity: [NaN, 0, 0],
      }),
    ).toBe(false);
  });
  it('accepts a target crossed between hosted-renderer snapshots', () => {
    expect(reachedRouteTarget([45.1, 61.6, 1.43], [44.8, 0.5], 'KeyW', 0.65, 1.5)).toBe(true);
    expect(reachedRouteTarget([44.5, 61.6, 1.43], [44.8, 0.5], 'KeyS', 0.65, 1.5)).toBe(true);
  });

  it('does not accept progress before the target or outside its route corridor', () => {
    expect(reachedRouteTarget([43, 61.6, 0.5], [44.8, 0.5], 'KeyW', 0.65, 1.5)).toBe(false);
    expect(reachedRouteTarget([47, 61.6, 2.1], [44.8, 0.5], 'KeyW', 0.65, 1.5)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { reachedRouteTarget } from './route-progress';

describe('Classic real-input route progress', () => {
  it('accepts a target crossed between hosted-renderer snapshots', () => {
    expect(reachedRouteTarget([45.1, 61.6, 1.43], [44.8, 0.5], 'KeyW', 0.65, 1.5)).toBe(true);
    expect(reachedRouteTarget([44.5, 61.6, 1.43], [44.8, 0.5], 'KeyS', 0.65, 1.5)).toBe(true);
  });

  it('does not accept progress before the target or outside its route corridor', () => {
    expect(reachedRouteTarget([43, 61.6, 0.5], [44.8, 0.5], 'KeyW', 0.65, 1.5)).toBe(false);
    expect(reachedRouteTarget([47, 61.6, 2.1], [44.8, 0.5], 'KeyW', 0.65, 1.5)).toBe(false);
  });
});

import { expect, it } from 'vitest';
import { transportControlFromWorldWish } from '../../src/server/gameplay/transport-motion-control';

it('projects accepted world-space input onto the current canonical heading', () => {
  expect(transportControlFromWorldWish(Math.PI / 2, { x: 1, z: 0 })).toEqual({ throttle: 1, steering: 0 });
  expect(transportControlFromWorldWish(0, { x: 0, z: 1 })).toEqual({ throttle: 1, steering: 0 });
  expect(transportControlFromWorldWish(Math.PI, { x: 0, z: -1 })).toEqual({ throttle: 1, steering: 0 });
});
it('uses reverse without turning the carrier when the wish points behind it', () => {
  expect(transportControlFromWorldWish(0, { x: 0, z: -1 })).toEqual({ throttle: -1, steering: 0 });
  expect(transportControlFromWorldWish(Math.PI / 2, { x: -1, z: 0 })).toEqual({ throttle: -1, steering: 0 });
});
it('turns toward a sideways wish while retaining propulsion and neutralizes no input', () => {
  expect(transportControlFromWorldWish(0, { x: 1, z: 0 })).toEqual({ throttle: 1, steering: 1 });
  expect(transportControlFromWorldWish(Math.PI / 2, { x: 0, z: 1 })).toEqual({ throttle: 1, steering: -1 });
  expect(transportControlFromWorldWish(1.7, { x: 0, z: 0 })).toEqual({ throttle: 0, steering: 0 });
});
it('rejects non-finite or out-of-range wishes rather than producing an invalid motion candidate', () => {
  expect(() => transportControlFromWorldWish(NaN, { x: 0, z: 1 })).toThrow();
  expect(() => transportControlFromWorldWish(0, { x: Infinity, z: 0 })).toThrow();
  expect(() => transportControlFromWorldWish(0, { x: 2, z: 0 })).toThrow();
});

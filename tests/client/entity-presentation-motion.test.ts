import { expect, it } from 'vitest';
import { movementPose, damageFlash } from '../../src/client/entity-presentation-motion';

it('模型正面 -Z 指向真实位移方向，静止不伪造行走', () => {
  expect(movementPose([0, 0, 0], [1, 0, 0], 1).yaw).toBe(-90);
  expect(Math.abs(movementPose([0, 0, 0], [0, 0, 1], 1).yaw!)).toBe(180);
  expect(movementPose([0, 0, 0], [0, 0, -1], 1).yaw).toBe(0);
  expect(movementPose([0, 0, 0], [0, 0, 0], 1)).toMatchObject({ yaw: null, stride: 0, bob: 0 });
});
it('受击闪烁只存在于短时间窗口并在结束时清零', () => {
  expect(damageFlash(2, 2.25)).toBeGreaterThan(0);
  expect(damageFlash(2.25, 2.25)).toBe(0);
  expect(damageFlash(3, 2.25)).toBe(0);
});

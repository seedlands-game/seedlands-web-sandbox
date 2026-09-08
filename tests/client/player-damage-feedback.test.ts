import { expect, it } from 'vitest';
import { playerDamageCameraOffset } from '../../apps/web/src/client/presentation/player-damage-feedback';

it('玩家受击相机冲击短促衰减，结束归零且伤害只做有界强度映射', () => {
  const early = playerDamageCameraOffset(0, 2);
  const middle = playerDamageCameraOffset(0.14, 2);
  expect(early.active).toBe(true);
  expect(Math.abs(early.yaw) + Math.abs(early.roll)).toBeGreaterThan(1);
  expect(Math.abs(middle.pitch) + Math.abs(middle.yaw) + Math.abs(middle.roll)).toBeLessThan(
    Math.abs(early.pitch) + Math.abs(early.yaw) + Math.abs(early.roll),
  );
  expect(playerDamageCameraOffset(0.28, 2)).toEqual({ pitch: 0, yaw: 0, roll: 0, active: false });
  expect(playerDamageCameraOffset(0, 100).roll).toBeLessThan(5);
});

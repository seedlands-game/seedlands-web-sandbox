import { describe, expect, it } from 'vitest';
import { resolveWaterMovement } from '../../src/app/water-movement-policy';

describe('涉水与游泳移动策略', () => {
  it('干地保持既有速度、重力和跳跃', () => {
    expect(resolveWaterMovement({ bodyFraction: 0, swimming: false }, 0, 0.016, 0)).toMatchObject({
      horizontalSpeed: 5.5,
      horizontalResponse: 12,
      gravity: 20,
      jumpAllowed: true,
    });
  });

  it('浅水降低水平速度但不启用游泳垂直控制', () => {
    const result = resolveWaterMovement({ bodyFraction: 0.35, swimming: false }, -1, 0.1, 1);
    expect(result.horizontalSpeed).toBeLessThan(5.5);
    expect(result.gravity).toBeLessThan(20);
    expect(result.jumpAllowed).toBe(true);
    expect(result.verticalVelocity).toBeLessThan(1);
  });

  it('深水加入阻力并响应上浮和下潜', () => {
    const neutral = resolveWaterMovement({ bodyFraction: 0.9, swimming: true }, 2, 0.1, 0);
    const rise = resolveWaterMovement({ bodyFraction: 0.9, swimming: true }, 2, 0.1, 1);
    const dive = resolveWaterMovement({ bodyFraction: 0.9, swimming: true }, 2, 0.1, -1);
    expect(neutral.horizontalSpeed).toBeLessThan(3);
    expect(Math.abs(neutral.verticalVelocity)).toBeLessThan(2);
    expect(rise.verticalVelocity).toBeGreaterThan(neutral.verticalVelocity);
    expect(dive.verticalVelocity).toBeLessThan(neutral.verticalVelocity);
    expect(neutral.jumpAllowed).toBe(false);
  });
});

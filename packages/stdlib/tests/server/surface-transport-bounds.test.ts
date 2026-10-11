import { expect, it } from 'vitest';
import { surfaceYawBounds } from '../../src/server/gameplay/surface-transport-bounds';
const hull = { min: { x: -0.75, y: 0, z: -0.75 }, max: { x: 0.75, y: 0.6, z: 0.75 } };
it('半周旋转包含中间 π/4 极值，不能只取起止包围盒', () => {
  const bounds = surfaceYawBounds(hull, 0, Math.PI);
  expect(bounds.min.x).toBeCloseTo(-Math.sqrt(1.125), 12);
  expect(bounds.max.z).toBeCloseTo(Math.sqrt(1.125), 12);
  expect(bounds.min.y).toBe(0);
  expect(bounds.max.y).toBe(0.6);
});
it.each([
  [0, 0.01],
  [2 * Math.PI - 0.01, 2 * Math.PI + 0.01],
  [-Math.PI - 0.01, -Math.PI + 0.01],
] as const)('小角度区间 %s 到 %s 不扩大成整圈，包含途中所有船角', (from, to) => {
  const bounds = surfaceYawBounds(hull, from, to);
  expect(bounds.max.x - bounds.min.x).toBeLessThan(1.52);
  expect(bounds.max.z - bounds.min.z).toBeLessThan(1.52);
  for (let step = 0; step <= 96; step++) {
    const yaw = from + ((to - from) * step) / 96;
    for (const x of [-0.75, 0.75])
      for (const z of [-0.75, 0.75]) {
        const rx = x * Math.cos(yaw) + z * Math.sin(yaw),
          rz = -x * Math.sin(yaw) + z * Math.cos(yaw);
        expect(rx).toBeGreaterThanOrEqual(bounds.min.x - 1e-12);
        expect(rx).toBeLessThanOrEqual(bounds.max.x + 1e-12);
        expect(rz).toBeGreaterThanOrEqual(bounds.min.z - 1e-12);
        expect(rz).toBeLessThanOrEqual(bounds.max.z + 1e-12);
      }
  }
});
it('完整及多周旋转覆盖不对称船体最远角，并保留高度', () => {
  const bounds = surfaceYawBounds({ min: { x: -1, y: -0.2, z: -2 }, max: { x: 0.5, y: 1, z: 0.25 } }, 0, 5 * Math.PI);
  expect(bounds.min.x).toBeCloseTo(-Math.sqrt(5), 12);
  expect(bounds.max.z).toBeCloseTo(Math.sqrt(5), 12);
  expect(bounds.min.y).toBe(-0.2);
  expect(bounds.max.y).toBe(1);
});

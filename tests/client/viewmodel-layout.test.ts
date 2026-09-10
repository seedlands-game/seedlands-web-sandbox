import { describe, expect, it } from 'vitest';
import { resolveViewmodelLayout } from '../../apps/web/src/client/presentation/viewmodel-layout';

describe('第一人称模型安全布局', () => {
  it.each([
    [700, 720],
    [1920, 1080],
    [5120, 2718],
  ])('在 %d×%d 下保持于右下安全区且远离近裁剪面', (width, height) => {
    const layout = resolveViewmodelLayout({ width, height, fov: 72 });
    expect(layout.normalizedAnchorX).toBeGreaterThan(0.3);
    expect(layout.normalizedAnchorX).toBeLessThanOrEqual(0.57);
    expect(layout.position.y).toBeLessThan(-0.2);
    expect(layout.position.z).toBeLessThanOrEqual(-1.2);
    expect(layout.scale).toBeGreaterThan(0);
    expect(layout.scale).toBeLessThanOrEqual(0.9);
  });
});

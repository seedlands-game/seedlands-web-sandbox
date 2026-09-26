import { describe, expect, it } from 'vitest';
import { resolveViewmodelLayout } from '../../../src/client/presentation/viewmodel-layout';

describe('第一人称模型安全布局', () => {
  it.each([
    [700, 720],
    [1920, 1080],
    [5120, 2718],
  ])('在 %d×%d 下保持于右下安全区且远离近裁剪面', (width, height) => {
    const layout = resolveViewmodelLayout({ width, height, fov: 72 });
    expect(layout.normalizedAnchorX).toBeGreaterThanOrEqual(0.36);
    expect(layout.normalizedAnchorX).toBeLessThanOrEqual(0.5);
    expect(layout.position.y).toBeLessThanOrEqual(-0.4);
    expect(layout.position.z).toBeLessThanOrEqual(-1.5);
    expect(layout.scale).toBeGreaterThan(0);
    expect(layout.scale).toBeLessThanOrEqual(0.66);
  });
});

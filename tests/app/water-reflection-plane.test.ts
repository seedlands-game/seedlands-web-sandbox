import { describe, expect, it } from 'vitest';
import { reflectionPlaneAboveCamera, waterReflectionSurfaceY } from '../../src/app/scene/water-reflection-plane';

describe('水面反射平面选择', () => {
  it('将暴露满水单元对齐到网格的七八码顶面', () => {
    expect(waterReflectionSurfaceY(58, 8, false)).toBe(58.875);
  });

  it('将流动水单元对齐到其 level 顶面', () => {
    expect(waterReflectionSurfaceY(58, 6, false)).toBe(58.75);
  });

  it('不把上方仍有水的下层当作暴露反射面', () => {
    expect(waterReflectionSurfaceY(58, 8, true)).toBeNull();
  });

  it('仅在相机位于选中水面上方时保留反射平面', () => {
    expect(reflectionPlaneAboveCamera(58.875, 60)).toBe(58.875);
  });

  it('在相机位于水面或水下时关闭反射平面', () => {
    expect(reflectionPlaneAboveCamera(58.875, 58.875)).toBeNull();
    expect(reflectionPlaneAboveCamera(58.875, 58.5)).toBeNull();
    expect(reflectionPlaneAboveCamera(null, 60)).toBeNull();
  });
});

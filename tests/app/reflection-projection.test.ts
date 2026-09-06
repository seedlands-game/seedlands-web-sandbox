import * as pc from 'playcanvas';
import { describe, expect, it } from 'vitest';
import {
  clipReflectionProjection,
  reflectionTextureMatrix,
  setReflectedCameraPose,
} from '../../src/app/scene/reflection-projection';

function uv(matrix: pc.Mat4, point: pc.Vec3) {
  const clip = matrix.transformVec4(new pc.Vec4(point.x, point.y, point.z, 1));
  return [clip.x / clip.w, clip.y / clip.w];
}

describe('倒影世界坐标投影', () => {
  it('斜近平面保留水上标记并裁掉水下河床', () => {
    const source = new pc.Entity();
    source.setPosition(0, 60, 7);
    source.setEulerAngles(-16, 0, 0);
    const reflected = new pc.Entity();
    setReflectedCameraPose(source, reflected, 56.875);
    const projection = clipReflectionProjection(
      new pc.Mat4().setPerspective(72, 16 / 9, 0.05, 150),
      reflected.getWorldTransform(),
      56.875,
    );
    const vp = new pc.Mat4().mul2(projection, new pc.Mat4().invert(reflected.getWorldTransform()));
    const above = vp.transformVec4(new pc.Vec4(-2, 60.875, -7, 1));
    const below = vp.transformVec4(new pc.Vec4(-2, 55, -7, 1));
    expect(above.z + above.w).toBeGreaterThan(0);
    expect(above.w - above.z).toBeGreaterThan(0);
    expect(below.z + below.w).toBeLessThan(0);
  });
  it.each([
    [-20, -12, 16 / 9],
    [25, -25, 21 / 9],
    [0, -35, 1],
  ])('yaw %s pitch %s aspect %s 时水面交点与反射物共用纹理位置', (yaw, pitch, aspect) => {
    const source = new pc.Entity();
    source.setPosition(0, 3, 6);
    source.setEulerAngles(pitch, yaw, 0);
    const reflected = new pc.Entity();
    setReflectedCameraPose(source, reflected, 0);
    const projection = new pc.Mat4().setPerspective(72, aspect, 0.05, 150);
    const matrix = reflectionTextureMatrix(projection, reflected.getWorldTransform(), true);
    const marker = new pc.Vec3(-2, 4, -7);
    const reflectedEye = reflected.getPosition();
    const t = -reflectedEye.y / (marker.y - reflectedEye.y);
    const surface = new pc.Vec3().lerp(reflectedEye, marker, t);
    expect(surface.y).toBeCloseTo(0);
    uv(matrix, surface).forEach((value, axis) => expect(value).toBeCloseTo(uv(matrix, marker)[axis], 6));
    const noFlip = reflectionTextureMatrix(projection, reflected.getWorldTransform(), false);
    expect(uv(matrix, marker)[0]).toBeCloseTo(uv(noFlip, marker)[0], 6);
    expect(uv(matrix, marker)[1]).toBeCloseTo(1 - uv(noFlip, marker)[1], 6);
    const stored = [...matrix.data];
    source.setEulerAngles(pitch + 10, yaw + 30, 0);
    expect([...matrix.data]).toEqual(stored);
  });
});

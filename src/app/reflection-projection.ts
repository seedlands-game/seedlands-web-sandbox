import * as pc from 'playcanvas';

export function setReflectedCameraPose(source: pc.Entity, reflected: pc.Entity, planeY: number) {
  const position = source.getPosition(),
    forward = source.forward,
    up = source.up;
  reflected.setPosition(position.x, 2 * planeY - position.y, position.z);
  reflected.lookAt(
    new pc.Vec3(position.x + forward.x, 2 * planeY - position.y - forward.y, position.z + forward.z),
    new pc.Vec3(up.x, -up.y, up.z),
  );
}

/** Maps world positions to the exact texture produced by this camera, including RT Y orientation. */
export function reflectionTextureMatrix(projection: pc.Mat4, cameraWorld: pc.Mat4, flipY: boolean): pc.Mat4 {
  const viewProjection = new pc.Mat4().mul2(projection, new pc.Mat4().invert(cameraWorld));
  const bias = new pc.Mat4();
  bias.data[0] = 0.5;
  bias.data[5] = flipY ? -0.5 : 0.5;
  bias.data[10] = 0.5;
  bias.data[12] = 0.5;
  bias.data[13] = 0.5;
  bias.data[14] = 0.5;
  return new pc.Mat4().mul2(bias, viewProjection);
}

/** Oblique near plane keeps only geometry above the reflecting water surface. */
export function clipReflectionProjection(projection: pc.Mat4, cameraWorld: pc.Mat4, planeY: number): pc.Mat4 {
  const m = cameraWorld.data;
  const plane = new pc.Vec4(m[1], m[5], m[9], m[13] - planeY);
  const corner = new pc.Mat4()
    .invert(projection)
    .transformVec4(new pc.Vec4(Math.sign(plane.x), Math.sign(plane.y), 1, 1));
  const denominator = plane.dot(corner);
  const result = projection.clone();
  if (Math.abs(denominator) < 1e-6) return result;
  plane.mulScalar(2 / denominator);
  const p = result.data;
  p[2] = plane.x - p[3];
  p[6] = plane.y - p[7];
  p[10] = plane.z - p[11];
  p[14] = plane.w - p[15];
  return result;
}

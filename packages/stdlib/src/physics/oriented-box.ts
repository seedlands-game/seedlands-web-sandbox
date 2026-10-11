import { COLLISION_EPSILON, dot } from './geometry';
import type { Vec3, WorldAabb } from './types';

export type OrientedBox = Readonly<{
  center: Vec3;
  axes: readonly [Vec3, Vec3, Vec3];
  half: readonly [number, number, number];
}>;

const worldAxes = [
  { x: 1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: 0, z: 1 },
] as const;
const components = ['x', 'y', 'z'] as const;
const finiteVector = (value: Vec3) => {
  if (!components.every((axis) => Number.isFinite(value[axis])))
    throw new TypeError('Oriented box vectors must be finite.');
};
const validateBounds = (bounds: WorldAabb) => {
  finiteVector(bounds.min);
  finiteVector(bounds.max);
  if (components.some((axis) => bounds.min[axis] >= bounds.max[axis]))
    throw new TypeError('Oriented box bounds must have positive volume.');
};

/** Local right/up/forward axes after inclination about local X, then canonical yaw. */
const rotationAxes = (yaw: number, inclination: number): OrientedBox['axes'] => {
  if (!Number.isFinite(yaw) || !Number.isFinite(inclination))
    throw new TypeError('Oriented box angles must be finite.');
  const cy = Math.cos(yaw),
    sy = Math.sin(yaw),
    cp = Math.cos(inclination),
    sp = Math.sin(inclination);
  return [
    { x: cy, y: 0, z: -sy },
    { x: -sy * sp, y: cp, z: -cy * sp },
    { x: sy * cp, y: sp, z: cy * cp },
  ];
};

export function rotateInclinedVector(value: Vec3, yaw: number, inclination: number): Vec3 {
  finiteVector(value);
  const axes = rotationAxes(yaw, inclination);
  return {
    x: value.x * axes[0].x + value.y * axes[1].x + value.z * axes[2].x,
    y: value.x * axes[0].y + value.y * axes[1].y + value.z * axes[2].y,
    z: value.x * axes[0].z + value.y * axes[1].z + value.z * axes[2].z,
  };
}

export function orientedBox(local: WorldAabb, position: Vec3, yaw = 0, inclination = 0): OrientedBox {
  validateBounds(local);
  finiteVector(position);
  const axes = rotationAxes(yaw, inclination);
  const center = rotateInclinedVector(
    {
      x: (local.min.x + local.max.x) / 2,
      y: (local.min.y + local.max.y) / 2,
      z: (local.min.z + local.max.z) / 2,
    },
    yaw,
    inclination,
  );
  return {
    center: { x: position.x + center.x, y: position.y + center.y, z: position.z + center.z },
    axes,
    half: [(local.max.x - local.min.x) / 2, (local.max.y - local.min.y) / 2, (local.max.z - local.min.z) / 2],
  };
}

const radius = (box: OrientedBox, axis: Vec3) =>
  box.half.reduce((sum, half, index) => sum + half * Math.abs(dot(box.axes[index]!, axis)), 0);

const validateBox = (box: OrientedBox) => {
  finiteVector(box.center);
  if (box.axes.length !== 3 || box.half.length !== 3 || box.half.some((half) => !Number.isFinite(half) || half <= 0))
    throw new TypeError('Oriented box requires three positive extents.');
  for (const [index, axis] of box.axes.entries()) {
    finiteVector(axis);
    if (
      Math.abs(dot(axis, axis) - 1) > 1e-8 ||
      box.axes.slice(index + 1).some((other) => Math.abs(dot(axis, other)) > 1e-8)
    )
      throw new TypeError('Oriented box axes must be orthonormal.');
  }
};

export function orientedBoxBounds(box: OrientedBox): WorldAabb {
  validateBox(box);
  const extent = { x: radius(box, worldAxes[0]), y: radius(box, worldAxes[1]), z: radius(box, worldAxes[2]) };
  return {
    min: { x: box.center.x - extent.x, y: box.center.y - extent.y, z: box.center.z - extent.z },
    max: { x: box.center.x + extent.x, y: box.center.y + extent.y, z: box.center.z + extent.z },
  };
}

const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

/** Continuous SAT for translation with fixed orientation; returns first contact, or null. */
export function sweepOrientedBox(box: OrientedBox, bounds: WorldAabb, delta: Vec3): number | null {
  validateBox(box);
  validateBounds(bounds);
  finiteVector(delta);
  const other = orientedBox(bounds, { x: 0, y: 0, z: 0 });
  const separation = {
    x: other.center.x - box.center.x,
    y: other.center.y - box.center.y,
    z: other.center.z - box.center.z,
  };
  const axes = [...worldAxes, ...box.axes, ...box.axes.flatMap((axis) => worldAxes.map((world) => cross(axis, world)))];
  let entry = -Infinity,
    exit = Infinity;
  for (const raw of axes) {
    const length = Math.hypot(raw.x, raw.y, raw.z);
    if (length <= 1e-10) continue;
    const axis = { x: raw.x / length, y: raw.y / length, z: raw.z / length };
    const distance = dot(separation, axis),
      speed = dot(delta, axis),
      extent = radius(box, axis) + radius(other, axis);
    if (Math.abs(speed) <= 1e-12) {
      if (Math.abs(distance) >= extent - COLLISION_EPSILON) return null;
      continue;
    }
    const near = (distance - extent) / speed,
      far = (distance + extent) / speed;
    entry = Math.max(entry, Math.min(near, far));
    exit = Math.min(exit, Math.max(near, far));
    if (exit <= Math.max(entry, 0) || entry > 1) return null;
  }
  return exit > Math.max(entry, 0) && entry <= 1 ? Math.max(0, entry) : null;
}

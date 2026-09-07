import { bodyConfigFor, type BodyKind } from '../../physics/body-registry';
import type { BodyState, Contact, Vec3, WorldAabb } from '../../physics/types';
import { collisionBoxesForVoxel } from '../../world/voxel-model';

export const COLLISION_DEBUG_RADIUS = 32;
export const COLLISION_DEBUG_BODY_LIMIT = 128;

export type CollisionDebugColor = readonly [number, number, number];
export type CollisionDebugLineSource =
  'authoritative-body' | 'predicted-body' | 'target-voxel' | 'contact-normal' | 'attraction-sensor' | 'pickup-sensor';

export type CollisionDebugSensor = Readonly<{
  id?: string;
  shape: 'sphere';
  center: Vec3;
  radius: number;
  purpose: 'attraction' | 'pickup';
}>;

export type CollisionDebugBody = Readonly<{
  id: string;
  kind: BodyKind;
  state: BodyState;
  grounded: boolean;
  contacts: readonly Contact[];
  sensors?: readonly CollisionDebugSensor[];
}>;

/** A read-only debug message from the authority. It deliberately has no render Entity references. */
export type CollisionDebugSnapshot = Readonly<{
  epoch: string;
  physicsTick: number;
  authoritative: readonly CollisionDebugBody[];
  predictedPlayer?: Readonly<{ id: string; kind: 'player'; state: BodyState; physicsTick?: number }>;
  targetVoxel?: Readonly<{ position: readonly [number, number, number]; voxel: number }>;
  truncatedBodyCount: number;
}>;

export type CollisionDebugProjectionOptions = Readonly<{
  includeContacts?: boolean;
  includeSensors?: boolean;
  includePickupSensors?: boolean;
}>;

export type CollisionDebugLine = Readonly<{
  source: CollisionDebugLineSource;
  color: CollisionDebugColor;
  vertexOffset: number;
  physicsTick: number;
  entityId?: string;
  voxel?: number;
  grounded?: boolean;
  sensorPurpose?: CollisionDebugSensor['purpose'];
}>;

export type CollisionDebugBatch = Readonly<{
  epoch: string;
  physicsTick: number;
  positions: Float32Array;
  colors: Float32Array;
  lines: readonly CollisionDebugLine[];
  visibleBodyCount: number;
  truncatedBodyCount: number;
  visibleSensorCount: number;
  contactCount: number;
}>;

const AUTHORITY_COLOR: CollisionDebugColor = [1, 0.5, 0.12];
const PREDICTION_COLOR: CollisionDebugColor = [0.1, 0.92, 1];
const TARGET_COLOR: CollisionDebugColor = [1, 0.85, 0.42];
const CONTACT_COLOR: CollisionDebugColor = [1, 0.3, 0.16];
const PICKUP_SENSOR_COLOR: CollisionDebugColor = [0.68, 0.3, 1];
const ATTRACTION_SENSOR_COLOR: CollisionDebugColor = [0.34, 0.5, 1];
const CONTACT_NORMAL_LENGTH = 0.28;
const SENSOR_RING_SEGMENTS = 24;

const EDGE_CORNERS = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
  [1, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [0, 1, 1],
  [1, 1, 1],
] as const;
const EDGE_INDICES = [
  [0, 1],
  [0, 2],
  [0, 4],
  [1, 3],
  [1, 5],
  [2, 3],
  [2, 6],
  [3, 7],
  [4, 5],
  [4, 6],
  [5, 7],
  [6, 7],
] as const;

type MutableLine = Omit<CollisionDebugLine, 'vertexOffset'> & { vertexOffset: number };

function withinRadius(position: Vec3, viewerPosition: Vec3): boolean {
  const dx = position.x - viewerPosition.x;
  const dy = position.y - viewerPosition.y;
  const dz = position.z - viewerPosition.z;
  return dx * dx + dy * dy + dz * dz <= COLLISION_DEBUG_RADIUS * COLLISION_DEBUG_RADIUS;
}

function squaredDistance(position: Vec3, viewerPosition: Vec3): number {
  const dx = position.x - viewerPosition.x;
  const dy = position.y - viewerPosition.y;
  const dz = position.z - viewerPosition.z;
  return dx * dx + dy * dy + dz * dz;
}

function defaultViewer(snapshot: CollisionDebugSnapshot): Vec3 {
  if (snapshot.predictedPlayer) return snapshot.predictedPlayer.state.position;
  return snapshot.authoritative.find((body) => body.kind === 'player')?.state.position ?? { x: 0, y: 0, z: 0 };
}

function appendLine(
  positions: number[],
  colors: number[],
  lines: MutableLine[],
  start: Vec3,
  end: Vec3,
  line: Omit<MutableLine, 'vertexOffset'>,
): void {
  const vertexOffset = positions.length / 3;
  positions.push(start.x, start.y, start.z, end.x, end.y, end.z);
  colors.push(...line.color, ...line.color);
  lines.push({ ...line, vertexOffset });
}

function appendAabb(
  positions: number[],
  colors: number[],
  lines: MutableLine[],
  aabb: WorldAabb,
  line: Omit<MutableLine, 'vertexOffset'>,
): void {
  const size = {
    x: aabb.max.x - aabb.min.x,
    y: aabb.max.y - aabb.min.y,
    z: aabb.max.z - aabb.min.z,
  };
  const corners = EDGE_CORNERS.map(([x, y, z]) => ({
    x: aabb.min.x + size.x * x,
    y: aabb.min.y + size.y * y,
    z: aabb.min.z + size.z * z,
  }));
  for (const [first, second] of EDGE_INDICES)
    appendLine(positions, colors, lines, corners[first], corners[second], line);
}

function appendSphere(
  positions: number[],
  colors: number[],
  lines: MutableLine[],
  center: Vec3,
  radius: number,
  line: Omit<MutableLine, 'vertexOffset'>,
): void {
  const point = (plane: number, angle: number): Vec3 => {
    const cosine = Math.cos(angle) * radius;
    const sine = Math.sin(angle) * radius;
    if (plane === 0) return { x: center.x + cosine, y: center.y + sine, z: center.z };
    if (plane === 1) return { x: center.x + cosine, y: center.y, z: center.z + sine };
    return { x: center.x, y: center.y + cosine, z: center.z + sine };
  };
  for (let plane = 0; plane < 3; plane += 1)
    for (let segment = 0; segment < SENSOR_RING_SEGMENTS; segment += 1) {
      const start = (segment / SENSOR_RING_SEGMENTS) * Math.PI * 2;
      const end = ((segment + 1) / SENSOR_RING_SEGMENTS) * Math.PI * 2;
      appendLine(positions, colors, lines, point(plane, start), point(plane, end), line);
    }
}

function bodyAabb(body: Pick<CollisionDebugBody, 'kind' | 'state'>): WorldAabb {
  const localAabb = bodyConfigFor(body.kind).localAabb;
  return {
    min: {
      x: body.state.position.x + localAabb.min.x,
      y: body.state.position.y + localAabb.min.y,
      z: body.state.position.z + localAabb.min.z,
    },
    max: {
      x: body.state.position.x + localAabb.max.x,
      y: body.state.position.y + localAabb.max.y,
      z: body.state.position.z + localAabb.max.z,
    },
  };
}

function appendContacts(
  positions: number[],
  colors: number[],
  lines: MutableLine[],
  body: CollisionDebugBody,
  physicsTick: number,
): void {
  for (const contact of body.contacts) {
    appendLine(
      positions,
      colors,
      lines,
      contact.point,
      {
        x: contact.point.x + contact.normal.x * CONTACT_NORMAL_LENGTH,
        y: contact.point.y + contact.normal.y * CONTACT_NORMAL_LENGTH,
        z: contact.point.z + contact.normal.z * CONTACT_NORMAL_LENGTH,
      },
      { source: 'contact-normal', color: CONTACT_COLOR, entityId: body.id, grounded: body.grounded, physicsTick },
    );
  }
}

/**
 * Builds a single GPU-friendly line batch from physics state only. This is intentionally
 * independent of PlayCanvas and never approximates a body from its presentation model.
 */
export function createCollisionDebugBatch(
  snapshot: CollisionDebugSnapshot,
  viewerPosition: Vec3 = defaultViewer(snapshot),
  options: CollisionDebugProjectionOptions = {},
): CollisionDebugBatch {
  const positions: number[] = [];
  const colors: number[] = [];
  const lines: MutableLine[] = [];
  let visibleSensorCount = 0;
  let contactCount = 0;
  const inRange = snapshot.authoritative
    .filter((body) => withinRadius(body.state.position, viewerPosition))
    .map((body, index) => ({ body, index, distance: squaredDistance(body.state.position, viewerPosition) }))
    .sort((left, right) => left.distance - right.distance || left.index - right.index)
    .slice(0, COLLISION_DEBUG_BODY_LIMIT);

  for (const { body } of inRange) {
    appendAabb(positions, colors, lines, bodyAabb(body), {
      source: 'authoritative-body',
      color: AUTHORITY_COLOR,
      entityId: body.id,
      grounded: body.grounded,
      physicsTick: snapshot.physicsTick,
    });
    if (options.includeContacts) {
      appendContacts(positions, colors, lines, body, snapshot.physicsTick);
      contactCount += body.contacts.length;
    }
    if (options.includeSensors || options.includePickupSensors)
      for (const sensor of body.sensors ?? []) {
        appendSphere(positions, colors, lines, sensor.center, sensor.radius, {
          source: sensor.purpose === 'pickup' ? 'pickup-sensor' : 'attraction-sensor',
          color: sensor.purpose === 'pickup' ? PICKUP_SENSOR_COLOR : ATTRACTION_SENSOR_COLOR,
          entityId: body.id,
          sensorPurpose: sensor.purpose,
          physicsTick: snapshot.physicsTick,
        });
        visibleSensorCount += 1;
      }
  }

  if (snapshot.predictedPlayer) {
    appendAabb(positions, colors, lines, bodyAabb(snapshot.predictedPlayer), {
      source: 'predicted-body',
      color: PREDICTION_COLOR,
      entityId: snapshot.predictedPlayer.id,
      physicsTick: snapshot.predictedPlayer.physicsTick ?? snapshot.physicsTick,
    });
  }

  if (snapshot.targetVoxel) {
    const [x, y, z] = snapshot.targetVoxel.position;
    for (const box of collisionBoxesForVoxel(snapshot.targetVoxel.voxel))
      appendAabb(
        positions,
        colors,
        lines,
        {
          min: { x: x + box.min[0], y: y + box.min[1], z: z + box.min[2] },
          max: { x: x + box.max[0], y: y + box.max[1], z: z + box.max[2] },
        },
        {
          source: 'target-voxel',
          color: TARGET_COLOR,
          voxel: snapshot.targetVoxel.voxel,
          physicsTick: snapshot.physicsTick,
        },
      );
  }

  return {
    epoch: snapshot.epoch,
    physicsTick: snapshot.physicsTick,
    positions: new Float32Array(positions),
    colors: new Float32Array(colors),
    lines,
    visibleBodyCount: inRange.length,
    truncatedBodyCount: snapshot.truncatedBodyCount + snapshot.authoritative.length - inRange.length,
    visibleSensorCount,
    contactCount,
  };
}

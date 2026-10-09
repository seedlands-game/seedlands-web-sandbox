import { bodyWorldAabb, sweepBodyThroughWorld, type BodyConfig, type WorldAabb } from '../../physics';
import { colliderMatches, overlapDepth, translateAabb, unionAabb } from '../../physics/geometry';
import type { AuthorityPhysicsFrame } from '../authority/authority-physics-frame';
import type { EntityStore } from './entity-store';
import type { GameplayCallbacks } from './gameplay-runtime-contracts';
import type { FrozenTransportInteractionConfig } from './modules/transport-interaction-config';
import type { TransportDefinitionV1, TransportStateV2 } from './modules/transport-model';
import type { TransportMotionPolicy } from './modules/transport-motion-module';
import {
  buildSurfaceTransportMotionCandidateV1,
  type TransportMotionCandidateV1,
} from './modules/transport-motion-model';
import { transportControlFromWorldWish } from './transport-motion-control';
import { transportBodyConfig } from './transport-body-config';

type Position = readonly [number, number, number];
const vector = (p: Position) => ({ x: p[0], y: p[1], z: p[2] });
const zero = { x: 0, y: 0, z: 0 };
const bounded = (bounds: WorldAabb) => {
  const count = (['x', 'y', 'z'] as const).reduce(
    (n, axis) => n * (Math.floor(bounds.max[axis] - 1e-8) - Math.floor(bounds.min[axis] + 1e-8) + 1),
    1,
  );
  return Number.isSafeInteger(count) && count > 0 && count <= 4096;
};

/** Includes rotation and the rider's body; it is a conservative collision volume, not a rendered shape. */
export function compoundBody(
  definition: TransportDefinitionV1,
  state: TransportStateV2,
  frame: AuthorityPhysicsFrame,
  turning: boolean,
  arcPad: number,
): BodyConfig {
  const config = transportBodyConfig(definition, state.pose.yaw);
  let bounds = config.localAabb;
  if (state.rider) {
    const rider = frame.bodyConfigs.get(state.rider.entityId);
    if (!rider) throw new Error('Transport rider has no current physics body.');
    const [x, y, z] = definition.seatOffset;
    const cosine = Math.cos(state.pose.yaw),
      sine = Math.sin(state.pose.yaw);
    bounds = unionAabb(
      bounds,
      translateAabb(rider.localAabb, { x: x * cosine + z * sine, y, z: -x * sine + z * cosine }),
    );
  }
  if (turning) {
    const radius =
      Math.max(
        ...[bounds.min.x, bounds.max.x].flatMap((x) => [bounds.min.z, bounds.max.z].map((z) => Math.hypot(x, z))),
      ) + arcPad;
    bounds = { min: { x: -radius, y: bounds.min.y, z: -radius }, max: { x: radius, y: bounds.max.y, z: radius } };
  }
  return { ...config, localAabb: bounds };
}

/** Bounds another carrier's arbitrary path around its endpoint chord for this frame only. */
export function compoundMotionPathBody(
  definition: TransportDefinitionV1,
  state: TransportStateV2,
  frame: AuthorityPhysicsFrame,
  distance: number,
): BodyConfig {
  const body = compoundBody(definition, state, frame, true, distance);
  return {
    ...body,
    localAabb: {
      min: { ...body.localAabb.min, y: body.localAabb.min.y - distance },
      max: { ...body.localAabb.max, y: body.localAabb.max.y + distance },
    },
  };
}

export function projectSurfaceMotion(
  options: Readonly<{
    state: TransportStateV2;
    definition: TransportDefinitionV1;
    policy: TransportMotionPolicy;
    policies: readonly TransportMotionPolicy[];
    config: FrozenTransportInteractionConfig;
    frame: AuthorityPhysicsFrame;
    entities: EntityStore;
    callbacks: Pick<GameplayCallbacks, 'getLoadedVoxel'>;
    motionPaths?: ReadonlyMap<string, TransportMotionCandidateV1>;
  }>,
) {
  const { state, definition, policy, policies, config, frame, entities, callbacks } = options;
  const driven =
    state.rider &&
    frame.playerReference &&
    state.rider.entityId === frame.playerReference.entityId &&
    state.rider.lifetime === frame.playerReference.lifetime &&
    state.rider.epoch === frame.playerReference.epoch &&
    entities.resolveReference(frame.playerReference);
  const controls = transportControlFromWorldWish(state.pose.yaw, driven ? frame.playerWish : { x: 0, z: 0 });
  const turning = controls.steering !== 0 && policy.steeringRate !== 0;
  const compound = compoundBody(
    definition,
    state,
    frame,
    turning,
    policy.maxSpeed * frame.seconds * policy.steeringRate * frame.seconds,
  );
  const supportBody = compoundBody(
    definition,
    { ...state, rider: null },
    frame,
    turning,
    policy.maxSpeed * frame.seconds * policy.steeringRate * frame.seconds,
  );
  const surface = config.surfaces.find((entry) => entry.id === definition.locomotion.providerId)!;
  const updates = new Map(frame.updates.map((entry) => [entry.id, entry.update]));
  const others = entities
    .query()
    .filter((entity) => entity.id !== state.reference.entityId && entity.id !== state.rider?.entityId)
    .flatMap((entity) => {
      let body = frame.bodyConfigs.get(entity.id);
      if (body && entity.type === 'transport') {
        const other = entities.transportState(entities.createReference(entity.id)!)!;
        const otherDefinition = config.definitions.require(other.definitionId);
        const otherPolicy = policies.find((entry) => entry.definitionId === other.definitionId);
        const otherDriven =
          other.rider &&
          frame.playerReference &&
          other.rider.entityId === frame.playerReference.entityId &&
          other.rider.lifetime === frame.playerReference.lifetime &&
          other.rider.epoch === frame.playerReference.epoch;
        if (otherDefinition.locomotion.provider === 'route') {
          body = compoundMotionPathBody(
            otherDefinition,
            other,
            frame,
            options.motionPaths?.get(entity.id)?.traveledDistance ?? 0,
          );
        } else if (
          otherPolicy &&
          otherDriven &&
          otherPolicy.steeringRate !== 0 &&
          transportControlFromWorldWish(other.pose.yaw, frame.playerWish).steering !== 0
        ) {
          body = compoundBody(
            otherDefinition,
            other,
            frame,
            true,
            otherPolicy.maxSpeed * frame.seconds * otherPolicy.steeringRate * frame.seconds,
          );
        }
      }
      return body ? [{ entity, body, next: updates.get(entity.id)?.position ?? entity.position }] : [];
    });
  return buildSurfaceTransportMotionCandidateV1(definition, state, {
    ...policy,
    ...controls,
    seconds: frame.seconds,
    sampleSurface(position) {
      const footprint = unionAabb(
        translateAabb(supportBody.localAabb, vector(state.pose.position)),
        translateAabb(supportBody.localAabb, vector(position)),
      );
      const y = position[1] - surface.surfaceOffset;
      if (Math.abs(y - Math.round(y)) > 1e-8 || !bounded(footprint)) return 'unsupported';
      for (let x = Math.floor(footprint.min.x + 1e-8); x <= Math.floor(footprint.max.x - 1e-8); x++)
        for (let z = Math.floor(footprint.min.z + 1e-8); z <= Math.floor(footprint.max.z - 1e-8); z++) {
          const cell = { min: { x, y: Math.round(y), z }, max: { x: x + 1, y: Math.round(y) + 1, z: z + 1 } };
          frame.world.querySolids(cell); // Record support revisions and request unknown chunks through the existing port.
          const voxel = callbacks.getLoadedVoxel?.([x, Math.round(y), z]);
          if (voxel === undefined) return 'unknown';
          if (!surface.voxels.includes(voxel)) return 'unsupported';
        }
      return 'supported';
    },
    sweep(from, to) {
      const start = { position: vector(from), velocity: zero };
      const delta = { x: to[0] - from[0], y: to[1] - from[1], z: to[2] - from[2] };
      const bounds = bodyWorldAabb(start, compound);
      if (!bounded(unionAabb(bounds, translateAabb(bounds, delta)))) return 'unknown';
      const blockers = frame.world.querySolids(unionAabb(bounds, translateAabb(bounds, delta)));
      if (
        blockers.some(
          (collider) => !collider.sensor && colliderMatches(compound, collider) && overlapDepth(bounds, collider.aabb),
        )
      )
        return blockers.some((collider) => collider.id?.startsWith('unknown:')) ? 'unknown' : 'world-collision';
      const worldResult = sweepBodyThroughWorld(start, compound, { querySolids: () => blockers }, delta);
      if (worldResult.contacts.length)
        return worldResult.contacts.some(({ collider }) => collider.id?.startsWith('unknown:'))
          ? 'unknown'
          : 'world-collision';
      for (const { entity, body, next } of others) {
        const collider = {
          id: entity.id,
          aabb: bodyWorldAabb({ position: vector(entity.position), velocity: zero }, body),
          layer: body.collisionLayer,
          mask: body.collisionMask,
        };
        if (!colliderMatches(compound, collider)) continue;
        const relative = {
          x: delta.x - (next[0] - entity.position[0]),
          y: delta.y - (next[1] - entity.position[1]),
          z: delta.z - (next[2] - entity.position[2]),
        };
        if (
          overlapDepth(bounds, collider.aabb) ||
          sweepBodyThroughWorld(start, compound, { querySolids: () => [collider] }, relative).contacts.length
        )
          return 'entity-collision';
      }
      return 'clear';
    },
  });
}

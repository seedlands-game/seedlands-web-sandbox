import { isBodyPositionReachable, type BodyConfig } from '../../physics';
import { WORLD_ITEM_INTERACTION } from '../../physics/body-registry';
import type { AuthorityBodySnapshot, AuthorityEntity, AuthorityServerPort } from './authority-session-types';
import type { VoxelCollisionWorld } from './voxel-collision-world';

const ITEM_PICKUP_RETRY_TICKS = 15;

const distanceSquared = (left: readonly number[], right: readonly number[]): number =>
  left.reduce((sum, value, index) => sum + (value - right[index]) ** 2, 0);

export function settleAuthorityPickups(
  options: Readonly<{
    server: AuthorityServerPort;
    bodyConfigFor: (entity: AuthorityEntity) => BodyConfig;
    collisionWorld: VoxelCollisionWorld;
    bodies: Map<string, AuthorityBodySnapshot>;
    attempts: Map<string, number>;
    physicsTick: number;
  }>,
  selectedTargets: ReadonlyMap<string, string>,
): void {
  const entities = options.server.queryEntities().sort((left, right) => left.id.localeCompare(right.id));
  const entityIds = new Set(entities.map((entity) => entity.id));
  const targets = [...(options.server.queryPickupTargets?.() ?? [])].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  for (const attempt of options.attempts.keys()) {
    const [itemId, targetId] = attempt.split('\0');
    const item = entities.find((entity) => entity.id === itemId);
    const target = targets.find((candidate) => candidate.id === targetId);
    if (
      !item ||
      !target ||
      selectedTargets.get(itemId) !== targetId ||
      distanceSquared(item.position, target.position) > WORLD_ITEM_INTERACTION.pickupRadius ** 2
    )
      options.attempts.delete(attempt);
  }
  if (!options.server.pickupItem) return;
  for (const item of entities.filter((entity) => entity.type === 'world-item')) {
    const target = targets.find((candidate) => candidate.id === selectedTargets.get(item.id));
    if (!target || distanceSquared(item.position, target.position) > WORLD_ITEM_INTERACTION.pickupRadius ** 2) continue;
    const body = options.bodies.get(item.id);
    if (!body) continue;
    const targetPosition = { x: target.position[0], y: target.position[1], z: target.position[2] };
    if (!isBodyPositionReachable(body.body, options.bodyConfigFor(item), options.collisionWorld, targetPosition))
      continue;
    const attempt = `${item.id}\0${target.id}`;
    const previousTick = options.attempts.get(attempt);
    if (previousTick !== undefined && options.physicsTick - previousTick < ITEM_PICKUP_RETRY_TICKS) continue;
    options.attempts.set(attempt, options.physicsTick);
    if (options.server.pickupItem(target.id, item.id).success) {
      options.bodies.delete(item.id);
      entityIds.delete(item.id);
    }
  }
  for (const id of options.bodies.keys()) if (!entityIds.has(id)) options.bodies.delete(id);
}

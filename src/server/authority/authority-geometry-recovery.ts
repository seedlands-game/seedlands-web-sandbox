import { bodyConfigFor, bodyKindForEntity } from '../../physics/body-registry';
import { bodyWorldAabb } from '../../physics/geometry';
import type { GameplayEntity } from '../gameplay/entity-store';
import type { WorldCommitResult } from '../game-server-types';

const EXTERNAL_GEOMETRY_RECOVERY_DISTANCE = 2;

export function queueBodyRecoveriesAfterCommit(
  commit: WorldCommitResult,
  entities: readonly GameplayEntity[],
  requestRecovery: (entityId: string, maxDistance: number) => void,
): void {
  const bounds = commit.structuralChange?.bounds;
  if (!commit.committed || !bounds) return;
  const changed = {
    min: { x: bounds.min[0], y: bounds.min[1], z: bounds.min[2] },
    max: { x: bounds.max[0] + 1, y: bounds.max[1] + 1, z: bounds.max[2] + 1 },
  };
  for (const entity of entities) {
    const body = bodyWorldAabb(
      {
        position: { x: entity.position[0], y: entity.position[1], z: entity.position[2] },
        velocity: {
          x: entity.physicsVelocity?.[0] ?? 0,
          y: entity.physicsVelocity?.[1] ?? 0,
          z: entity.physicsVelocity?.[2] ?? 0,
        },
      },
      bodyConfigFor(bodyKindForEntity(entity)),
    );
    if (
      body.max.x <= changed.min.x ||
      body.min.x >= changed.max.x ||
      body.max.y <= changed.min.y ||
      body.min.y >= changed.max.y ||
      body.max.z <= changed.min.z ||
      body.min.z >= changed.max.z
    )
      continue;
    requestRecovery(entity.id, EXTERNAL_GEOMETRY_RECOVERY_DISTANCE);
  }
}

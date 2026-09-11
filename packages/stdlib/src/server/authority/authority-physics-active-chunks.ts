import { bodyWorldAabb, type BodyConfig } from '../../physics';
import { CHUNK_SIZE, chunkKey, floorDiv } from '../../world/voxel';
import type { AuthorityEntity } from './authority-session-types';

export function bodyActiveChunkKeys(
  entities: readonly AuthorityEntity[],
  configFor: (entity: AuthorityEntity) => BodyConfig,
): readonly string[] {
  const keys = new Set<string>();
  entities.forEach((entity) => {
    const config = configFor(entity);
    const bounds = bodyWorldAabb(
      {
        position: { x: entity.position[0], y: entity.position[1], z: entity.position[2] },
        velocity: {
          x: entity.physicsVelocity?.[0] ?? 0,
          y: entity.physicsVelocity?.[1] ?? 0,
          z: entity.physicsVelocity?.[2] ?? 0,
        },
      },
      config,
    );
    const minimum = [bounds.min.x, bounds.min.y, bounds.min.z].map((value) =>
      floorDiv(Math.floor(value - 1), CHUNK_SIZE),
    );
    const maximum = [bounds.max.x, bounds.max.y, bounds.max.z].map((value) =>
      floorDiv(Math.floor(value + 1 - Number.EPSILON), CHUNK_SIZE),
    );
    for (let cx = minimum[0]; cx <= maximum[0]; cx += 1)
      for (let cy = minimum[1]; cy <= maximum[1]; cy += 1)
        for (let cz = minimum[2]; cz <= maximum[2]; cz += 1) keys.add(chunkKey(cx, cy, cz));
  });
  return [...keys].sort((left, right) => left.localeCompare(right));
}

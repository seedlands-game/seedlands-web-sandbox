import { Voxel } from '../../world/voxel';
import type { WorldCommitResult } from '../game-server-types';
import type { GameplayCallbacks, GameplayResult } from './gameplay-runtime-contracts';
import type { EnvironmentRuntime } from './environment-runtime';
import type { VoxelGameplayRegistry } from './voxel-gameplay';
import type { EntityStore } from './entity-store';
import { advanceGameplayRules } from './gameplay-runtime-lifecycle';

export function advanceGameplayEnvironment(
  environment: EnvironmentRuntime,
  seconds: number,
  callbacks: GameplayCallbacks,
  voxels: VoxelGameplayRegistry,
  entities?: EntityStore,
  damage?: (sourceId: string, targetId: string, amount: number, cause: string) => GameplayResult,
): WorldCommitResult[] {
  const effects = environment.advance(seconds, {
    flammable: ([x, y, z]) => {
      if (callbacks.getVoxel([x, y, z]) !== Voxel.Air) return false;
      return [
        [1, 0, 0],
        [-1, 0, 0],
        [0, -1, 0],
        [0, 0, 1],
        [0, 0, -1],
      ].some(([dx, dy, dz]) => {
        const voxel = callbacks.getVoxel([x + dx, y + dy, z + dz]);
        return voxel === Voxel.Wood || voxel === Voxel.Leaves || voxel === Voxel.Planks || voxel === Voxel.Tnt;
      });
    },
    skyVisible: ([x, y, z]) => {
      for (let above = y + 1; above < 64; above++) if (callbacks.getVoxel([x, above, z]) !== Voxel.Air) return false;
      return true;
    },
  });
  const explosionPositions = new Map<string, readonly [number, number, number]>();
  for (const effect of effects.explosions)
    for (const at of effect.blocks) {
      const voxel = callbacks.getVoxel([...at]);
      if (voxel !== undefined && voxel !== Voxel.Air && voxels.require(voxel).hardnessSeconds !== null)
        explosionPositions.set(at.join(','), at);
    }
  const edits = [
    ...effects.extinguished
      .filter((at) => callbacks.getVoxel([...at]) === Voxel.Fire)
      .map(([x, y, z]) => ({ x, y, z, value: Voxel.Air })),
    ...effects.ignited
      .filter((at) => callbacks.getVoxel([...at]) === Voxel.Air)
      .map(([x, y, z]) => ({ x, y, z, value: Voxel.Fire })),
    ...[...explosionPositions.values()].map(([x, y, z]) => ({ x, y, z, value: Voxel.Air })),
  ];
  const commits = !edits.length || !callbacks.editBatch ? [] : [callbacks.editBatch({ actorId: 'environment', edits })];
  for (const effect of effects.explosions)
    for (const entity of (entities?.query() ?? []).sort((a, b) => a.id.localeCompare(b.id))) {
      if (entity.type !== 'player' || entity.health === undefined || entity.health <= 0) continue;
      const delta = entity.position.map((value, axis) => value - effect.position[axis]) as [number, number, number];
      const distance = Math.hypot(...delta);
      if (distance > effect.power * 2) continue;
      const strength = Math.max(0, 1 - distance / (effect.power * 2));
      const result = damage?.(
        'environment:tnt:' + effect.id,
        entity.id,
        Math.max(1, effect.power * 4 * strength),
        'explosion',
      );
      if (result?.success && entities?.get(entity.id)?.health) {
        const length = Math.hypot(delta[0], delta[2]) || 1;
        entities.update(entity.id, {
          physicsVelocity: [(delta[0] / length) * strength * 6, strength * 4, (delta[2] / length) * strength * 6],
        });
      }
    }
  return commits;
}

export function advanceGameplayWithEnvironment(
  seconds: number,
  options: Parameters<typeof advanceGameplayRules>[1] &
    Readonly<{
      environment: EnvironmentRuntime;
      callbacks: GameplayCallbacks;
      voxels: VoxelGameplayRegistry;
      entities: EntityStore;
      damage(source: string, target: string, amount: number, cause: string): GameplayResult;
      synchronizeSchedule(): void;
    }>,
) {
  try {
    const result = advanceGameplayRules(seconds, options);
    const environment = advanceGameplayEnvironment(
      options.environment,
      seconds,
      options.callbacks,
      options.voxels,
      options.entities,
      options.damage,
    );
    return { commits: [...result.commits, ...environment] };
  } finally {
    options.synchronizeSchedule();
  }
}

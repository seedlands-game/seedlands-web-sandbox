import type { GameplayRuntime } from './gameplay-runtime';
import type { GameplayCallbacks } from './gameplay-runtime-contracts';
import { sampleLight } from './light-sampler';
import { attemptNaturalSpawn } from './natural-spawn-runtime';
import type { SpawnCandidate } from './spawn-policy';
import { saplingGrowthEdits } from '../../world/vegetation';
import { dungeonLoot } from '../../world/dungeon-generation';
import { Voxel } from '../../world/voxel';
import type { EcsActorArchetype } from './ecs-entity-owner';

type Position = [number, number, number];
export class GameplayEnvironmentFacade {
  constructor(
    private readonly runtime: GameplayRuntime,
    private readonly callbacks: GameplayCallbacks,
  ) {}
  lightAt(position: Position) {
    return sampleLight(
      position,
      this.callbacks.getWorldTime(),
      this.callbacks.getLoadedVoxel ?? this.callbacks.getVoxel,
    );
  }
  attemptNaturalSpawn(candidates: readonly SpawnCandidate[], position: Position, tick: number) {
    return attemptNaturalSpawn(this.runtime, this.callbacks, candidates, position, tick);
  }
  attemptDungeonSpawner(
    dungeonId: string,
    position: Position,
    seconds: number,
    archetype: EcsActorArchetype = 'zombie',
  ) {
    if (this.callbacks.getLoadedVoxel?.(position) !== Voxel.Spawner)
      return { success: false as const, reason: 'spawner-not-loaded' };
    if (this.runtime.difficulty.value === 'peaceful') return { success: false as const, reason: 'spawn-rejected' };
    const light = this.lightAt(position);
    const players = this.runtime.queryEntities({ type: 'player' });
    const nearest = players.reduce(
      (best, player) => Math.min(best, Math.hypot(...player.position.map((value, axis) => value - position[axis]))),
      Infinity,
    );
    const hostileCount = this.runtime.simulation
      .queryActors()
      .filter((actor) => this.runtime.content.actorProfiles.require(actor.archetype).disposition === 'hostile').length;
    if (!light || light.level > 7 || nearest > 16 || hostileCount >= 16)
      return { success: false as const, reason: 'spawn-rejected' };
    const activation = this.runtime.environment.advanceDungeonSpawner(dungeonId, seconds);
    if (activation === null) return { success: false as const, reason: 'spawner-cooldown' };
    const entity = this.runtime.spawnAutonomous(
      {
        id: `dungeon-${dungeonId.replace(/[^a-zA-Z0-9_-]/g, '_')}-${activation}`,
        archetype,
        position: [position[0] + 0.5, position[1] + 1, position[2] + 0.5],
      },
      { archetype },
    );
    return { success: true as const, entity };
  }
  openDungeonChest(playerId: string, dungeonId: string, chestIndex: number, position: Position) {
    const chestId = `${dungeonId}:${chestIndex}`;
    if (this.callbacks.getLoadedVoxel?.(position) !== Voxel.DungeonChest)
      return { success: false as const, reason: 'chest-not-loaded' };
    if (this.runtime.environment.isDungeonChestOpened(chestId))
      return { success: false as const, reason: 'chest-opened' };
    const player = this.runtime.getEntity(playerId);
    if (!player || Math.hypot(...player.position.map((value, axis) => value - position[axis])) > 6)
      return { success: false as const, reason: 'out-of-range' };
    const loot = dungeonLoot(this.callbacks.environmentSeed ?? 0, dungeonId, chestIndex);
    for (const stack of loot) {
      const result = this.runtime.giveItem(playerId, stack);
      if (!result.success) return result;
    }
    this.runtime.environment.markDungeonChestOpened(chestId);
    return { success: true as const, loot };
  }
  growSapling(position: Position) {
    const edits = saplingGrowthEdits(position, (x, y, z) =>
      (this.callbacks.getLoadedVoxel ?? this.callbacks.getVoxel)([x, y, z]),
    );
    if (!edits || !this.callbacks.editBatch) return { success: false as const, reason: 'growth-blocked' };
    const commit = this.callbacks.editBatch({ actorId: 'environment:sapling', edits });
    return commit.committed
      ? { success: true as const, commit }
      : { success: false as const, reason: 'world-not-changed' };
  }
}

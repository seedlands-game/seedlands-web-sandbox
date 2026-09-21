import type { GameplayRuntime } from './gameplay-runtime';
import type { GameplayCallbacks } from './gameplay-runtime-contracts';
import { sampleLight } from './light-sampler';
import { attemptNaturalSpawn } from './natural-spawn-runtime';
import type { SpawnCandidate } from './spawn-policy';
import { saplingGrowthEdits } from '../../world/vegetation';

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

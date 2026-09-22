import type { ModModule } from '../composition/contracts';
import type { CompositionCheckpointIdentity } from '../composition/checkpoint-identity';

/** A Pack-owned, user-visible account of one restore-time compatibility change. */
export type GameplaySnapshotMigrationReport = Readonly<{
  id: string;
  removedActorIds: readonly string[];
}>;

export type GameplaySnapshotMigrationContext = Readonly<{
  targetComposition: CompositionCheckpointIdentity | null;
}>;

export type GameplaySnapshotMigration = Readonly<{
  migrate(
    snapshot: unknown,
    context: GameplaySnapshotMigrationContext,
  ): Readonly<{ snapshot: unknown; reports: readonly GameplaySnapshotMigrationReport[] }>;
}>;

export const GAMEPLAY_SNAPSHOT_MIGRATION_CAPABILITY = 'seedlands:gameplay-snapshot-migration';

/**
 * Registers one Pack-owned snapshot projection. It runs after the generic
 * envelope check and before the composition guard verifies the projected save.
 */
export function defineGameplaySnapshotMigrationModule(
  input: Readonly<{ moduleId: string; migration: GameplaySnapshotMigration }>,
): ModModule {
  return Object.freeze({
    descriptor: {
      id: input.moduleId,
      version: '1.0.0',
      provides: [{ id: GAMEPLAY_SNAPSHOT_MIGRATION_CAPABILITY, version: '1.0.0' }],
    },
    register(api) {
      api.provideCapability(GAMEPLAY_SNAPSHOT_MIGRATION_CAPABILITY, input.migration);
    },
  } satisfies ModModule);
}

import type { GameplayRuntime } from './gameplay/gameplay-runtime';
import type { GameplaySnapshotMigrationReport } from './gameplay/gameplay-snapshot-migration';

export type PreparedGameplayRestore = Readonly<{
  gameplay: GameplayRuntime;
  restoredVersion: 1 | 2 | 3 | 4 | null;
  snapshotMigrationReports: readonly GameplaySnapshotMigrationReport[];
}>;

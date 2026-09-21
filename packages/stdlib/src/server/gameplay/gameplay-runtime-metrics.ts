import { gameplayEntityMetrics } from './gameplay-entity-metrics';
import type { EntityStore } from './entity-store';
import type { AutonomyRuntime } from '../simulation/autonomy-runtime';

export const gameplayRuntimeMetrics = (
  entities: EntityStore,
  simulation: AutonomyRuntime,
  inventoryOperationCount: number,
  gameplayEventCount: number,
  snapshotBytes: number,
) => ({
  ...gameplayEntityMetrics(entities),
  inventoryOperationCount,
  gameplayEventCount,
  snapshotBytes,
  ...simulation.metrics(),
});

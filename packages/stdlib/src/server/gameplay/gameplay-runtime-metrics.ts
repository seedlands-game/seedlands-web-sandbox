import { gameplayEntityMetrics } from './gameplay-entity-metrics';
import type { EntityStore } from './entity-store';
import type { AutonomyRuntime } from '../simulation/autonomy-runtime';
import type { CorePlatformPorts } from '../../runtime/platform-ports';

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

export const collectGameplayRuntimeMetrics = (
  options: Readonly<{
    entities: EntityStore;
    simulation: AutonomyRuntime;
    inventoryOperationCount: number;
    gameplayEventCount: number;
    platform: CorePlatformPorts;
    snapshot(): unknown;
  }>,
) =>
  gameplayRuntimeMetrics(
    options.entities,
    options.simulation,
    options.inventoryOperationCount,
    options.gameplayEventCount,
    options.platform.utf8.encode(JSON.stringify(options.snapshot())).byteLength,
  );

import type { GameplayRuntime } from './gameplay-runtime';
import { collectGameplayRuntimeMetrics } from './gameplay-runtime-metrics';

export const collectRuntimeStatistics = (
  runtime: GameplayRuntime,
  inventoryOperationCount: number,
  eventCount: number,
) =>
  collectGameplayRuntimeMetrics({
    entities: runtime.entities,
    simulation: runtime.simulation,
    inventoryOperationCount,
    gameplayEventCount: eventCount,
    platform: runtime.platform,
    snapshot: runtime.createSnapshot,
  });

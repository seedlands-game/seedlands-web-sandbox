import type { ModuleOwned } from './operation-contracts';

export type ModLifecycleDefinition = Readonly<{ startOperationId?: string; stopOperationId?: string }>;
type ModSystemBase = Readonly<{
  id: string;
  operationId: string;
  before?: readonly string[];
  after?: readonly string[];
}>;
export type ModSystemDefinition = ModSystemBase &
  Readonly<{ cadence?: 'interval'; intervalSeconds: number } | { cadence: 'every-advance'; intervalSeconds?: never }>;
export type LifecycleRegistrations = Readonly<{
  lifecycles: readonly ModuleOwned<ModLifecycleDefinition>[];
  systems: readonly ModuleOwned<ModSystemDefinition>[];
}>;
export type ModuleScheduleSnapshot = Readonly<{
  version: 1;
  time: number;
  systems: readonly Readonly<{ id: string; remainder: number }>[];
}>;

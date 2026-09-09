import type { ModuleOwned } from './operation-contracts';

export type ModLifecycleDefinition = Readonly<{ startOperationId?: string; stopOperationId?: string }>;
export type ModSystemDefinition = Readonly<{
  id: string;
  operationId: string;
  intervalSeconds: number;
  before?: readonly string[];
  after?: readonly string[];
}>;
export type LifecycleRegistrations = Readonly<{
  lifecycles: readonly ModuleOwned<ModLifecycleDefinition>[];
  systems: readonly ModuleOwned<ModSystemDefinition>[];
}>;
export type ModuleScheduleSnapshot = Readonly<{
  version: 1;
  time: number;
  systems: readonly Readonly<{ id: string; remainder: number }>[];
}>;

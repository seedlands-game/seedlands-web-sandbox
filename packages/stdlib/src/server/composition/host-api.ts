export { assembleWorldPacks, createWorldFromPacks } from './assembly';
export { createAuthorizedModuleExecution, type ModuleResourceExecutor } from './authorized-execution';
export type {
  ArtifactDigest,
  ArtifactIntegrityReceipt,
  AssembleWorldPackOptions,
  VerifiedPackArtifact,
  WorldComposition,
  WorldDefinitionMap,
} from './contracts';
export { createRegisteredOperationRuntime } from './registered-operations';
export { createModuleLifecycle } from './module-lifecycle';
export {
  gameplayContentForComposition,
  assembleOverworldPacks,
  OVERWORLD_PRODUCT_PERMISSIONS,
} from './gameplay-composition';
export type { ModuleScheduleSnapshot } from './lifecycle-contracts';
export type {
  RegisteredStatePort,
  RegisteredCommitContext,
  PreparedRegisteredCommit,
  RegisteredOperationBinding,
  RegisteredOperationExecution,
  RegisteredOperationResult,
  RegisteredOperationRuntimeOptions,
  ObservedModState,
  ModStateWrite,
} from './operation-contracts';

export { createGameplaySystemAuthority } from './gameplay-system-authority';

export { createGameplayActorAuthority, type ModuleActorAuthority } from './gameplay-actor-authority';

export { assembleProductPacks, ALTERNATIVE_PRODUCT_PERMISSIONS } from './product-playbooks';
export type { AssembleProductPackOptions, ProductExtensionAdmission } from './product-playbooks';
export { worldgenProviderForComposition, WORLDGEN_PROVIDER_CAPABILITY } from '../worldgen/standard-worldgen-module';
export type { StandardWorldgenProvider } from '../worldgen/standard-worldgen-module';
export { createGameplayKernelRuntime } from '../gameplay/gameplay-kernel-runtime';

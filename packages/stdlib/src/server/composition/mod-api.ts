export { definePack } from './assembly';
export type {
  BehaviorArguments,
  BehaviorCapability,
  BehaviorCapabilityReference,
  BehaviorCondition,
  BehaviorDefinition,
  BehaviorGoal,
  BehaviorJson,
  BehaviorNode,
  BehaviorOperationRequirement,
  BehaviorSkillCheckpoint,
} from '../../runtime/behavior-control-protocol';
export type { ModLifecycleDefinition, ModSystemDefinition } from './lifecycle-contracts';
export type { AuthorizedModuleExecution, ModuleExecutionContext, ModuleInvocationResult } from './authorized-execution';
export type {
  CapabilityContract,
  ModItemAmount,
  ModItemDefinition,
  ModModule,
  ModModuleDescriptor,
  ModRecipeDefinition,
  ModVoxelDefinition,
  ModRegistrationFacade,
  ModDefinitionCatalog,
  ModuleInvocation,
  ModuleInvocationValue,
  ModulePermission,
  PackDefinitionInput,
  PackDependency,
  PackKind,
  PackManifest,
  PackPresentationReference,
  PackDefinition,
  ProviderSelection,
  ModRegistrationIdentity,
} from './contracts';

export { BEHAVIOR_REGISTRY_CAPABILITY } from './behavior-capability-registry';
export type {
  BehaviorActorSnapshot,
  BehaviorCapabilityRegistry,
  BehaviorConditionContext,
  BehaviorConditionProviderDefinition,
  BehaviorProviderContext,
  BehaviorProviderDefinition,
  BehaviorProviderOrigin,
  BehaviorRuntimeContext,
  BehaviorSkillProviderDefinition,
  BehaviorSkillProviderResult,
} from './behavior-capability-registry';
export {
  defineBehaviorCapabilityModule,
  defineBehaviorRegistryModule,
} from '../gameplay/modules/behavior-registry-module';
export type { BehaviorCapabilityModuleInput } from '../gameplay/modules/behavior-registry-module';

export type {
  ModStateAddress,
  ModStateDefinition,
  ModCandidateState,
  ModOperationDefinition,
  ModRuleDefinition,
  RegisteredOperationRequest,
  CommittedOperationFact,
} from './operation-contracts';

export { defineInventoryModule } from '../gameplay/modules/inventory-module';
export { defineContentModule } from '../gameplay/modules/content-module';
export {
  defineGameplaySnapshotMigrationModule,
  GAMEPLAY_SNAPSHOT_MIGRATION_CAPABILITY,
} from '../gameplay/gameplay-snapshot-migration';
export type {
  GameplaySnapshotMigration,
  GameplaySnapshotMigrationContext,
  GameplaySnapshotMigrationReport,
} from '../gameplay/gameplay-snapshot-migration';
export { defineStandardWorldgenModule, WORLDGEN_PROVIDER_CAPABILITY } from '../worldgen/standard-worldgen-module';
export type { StandardWorldgenProvider } from '../worldgen/standard-worldgen-module';
export type { KernelWorldgenProviderIdentity } from '@seedlands/kernel/spatial';
export type { MeleeDefinition } from '../gameplay/combat-runtime';
export type {
  ActorNavigationProfile,
  ActorProfile,
  ActorProfileInput,
  ActorProfileRegistry,
  AutonomousActorEntityType,
  StarterEcologyActorInput,
  StarterEcologyActorSlot,
  StarterEcologyConfiguration,
  StarterEcologyConfigurationInput,
} from '../gameplay/actor-profile';
export type { ActorArchetype } from '../gameplay/entity-store';
export type { ActorBehavior } from '../simulation/actor-state';
export { defineCraftingProviderModule, defineRecipeCraftingModule } from '../gameplay/modules/recipe-crafting-module';
export type {
  CraftingConsumptionV1,
  CraftingMatchRequestV1,
  CraftingProviderV1,
} from '../gameplay/modules/crafting-provider';
export { createInventoryCandidate } from '../gameplay/modules/inventory-api';
export type { ItemDefinitionRegistry, ItemDefinitionInput, ItemStack } from '../gameplay/item-registry';
export type { Recipe } from '../gameplay/recipe-registry';
export { createVoxelGeometryRegistryV1 } from '../../world/voxel-geometry';
export type {
  VoxelGeometryBoxV1,
  VoxelGeometryDefinitionV1,
  VoxelGeometryRegistryV1,
  VoxelGeometryVectorV1,
  VoxelRenderBoxV1,
} from '../../world/voxel-geometry';
export {
  defineVoxelGeometryModule,
  voxelGeometryForComposition,
  VOXEL_GEOMETRY_CAPABILITY,
} from '../gameplay/modules/voxel-geometry-module';
export type { VoxelGeometryModuleOptionsV1 } from '../gameplay/modules/voxel-geometry-module';
export { defineItemInteractionModule, ITEM_INTERACTION_CAPABILITY } from '../gameplay/modules/item-interaction-module';
export type {
  ItemInteractionDefinition,
  ItemInteractionRegistryV1,
  ItemInteractionTarget,
  ItemInteractionTrigger,
} from '../gameplay/modules/item-interaction-module';
export { defineFluidContainerInteractionModule } from '../gameplay/modules/fluid-container-interaction';
export type { FluidContainerInteractionConfig } from '../gameplay/modules/fluid-container-interaction';
export {
  defineStructureDefinitionV1,
  resolveStructureRootV1,
  structureFootprintV1,
  transitionStructureStateV1,
} from '../gameplay/modules/structure-definition';
export type {
  ResolvedStructureV1,
  StructureCellReaderV1,
  StructureDefinitionInputV1,
  StructureDefinitionV1,
  StructureFootprintPartV1,
  StructureOffsetV1,
  StructurePartDefinitionV1,
  StructureLegacyStateDefinitionV1,
  StructurePositionV1,
  StructureStateDefinitionV1,
  StructureTransitionDefinitionV1,
} from '../gameplay/modules/structure-definition';
export {
  createStructureDefinitionRegistryV1,
  defineStructureDefinitionModule,
  STRUCTURE_DEFINITIONS_CAPABILITY,
} from '../gameplay/modules/structure-definition-module';
export type {
  StructureDefinitionModuleOptions,
  StructureDefinitionRegistryV1,
  StructureVariantResolutionV1,
} from '../gameplay/modules/structure-definition-module';
export {
  assertStructureMultiEditReadsV1,
  buildStructurePlacementCandidateV1,
  buildStructureTransitionCandidateV1,
  prepareStructureMultiEditParticipantV1,
  validateStructureMultiEditCandidateV1,
} from '../gameplay/modules/structure-multi-edit-model';
export type {
  PreparedStructureMultiEditParticipantV1,
  PreparedStructureVoxelBatchV1,
  StructureMultiEditCandidateV1,
  StructureMultiEditHostV1,
  StructureVoxelEditCandidateV1,
} from '../gameplay/modules/structure-multi-edit-model';

export { defineModeModule } from '../gameplay/modules/mode-module';

export { defineRulesetModule } from '../gameplay/modules/ruleset-module';
export type { WorldRulesetDefinition, WorldRulesetV1 } from '../gameplay/modules/ruleset-module';

export { defineNeedsModule } from '../gameplay/modules/needs-module';
export { defineNeedsRulesModule } from '../gameplay/modules/needs-rules-module';
export type { NeedsProfiles, NeedsProfile } from '../gameplay/modules/needs-model';

export { defineCombatModule } from '../gameplay/modules/combat-module';
export { defineCombatRulesModule } from '../gameplay/modules/combat-rules-module';
export * from '../gameplay/modules/combat-model';

export { defineInventoryActionsModule } from '../gameplay/modules/inventory-actions-module';
export * from '../gameplay/modules/inventory-action-model';

export {
  defineBlockActionsModule,
  buildBlockActionCandidate,
  buildBlockAdvanceUpdates,
} from '../gameplay/modules/block-actions-module';
export type { VoxelGameplayDefinition } from '../gameplay/voxel-gameplay';
export type { VoxelSemanticsDefinition, VoxelSemanticsRegistry } from '../../world/voxel-semantics';
export type { BlockRulesCapabilityV1 } from '../gameplay/modules/block-rules-module';
export { defineBlockRulesModule } from '../gameplay/modules/block-rules-module';
export * from '../gameplay/modules/block-action-model';

export { defineFeedingActionsModule } from '../gameplay/modules/feeding-actions-module';
export { defineFeedingRulesModule } from '../gameplay/modules/feeding-rules-module';
export * from '../gameplay/modules/feeding-model';

export { createMiningToolUseCandidate } from '../gameplay/modules/mining-tool-policy';
export type { MiningToolRequirement, MiningToolUseCandidate } from '../gameplay/modules/mining-tool-policy';

export type { StationContent, StationContentInput } from '../gameplay/station-content';
export type { StationDefinition, StationKind, StationComponentV1 } from '../gameplay/ecs-station-state';
export type {
  StationRecipe,
  ShapedStationRecipe,
  ShapelessStationRecipe,
} from '../gameplay/modules/station-candidates';
export { stationRecipeFitsGrid } from '../gameplay/modules/station-candidates';
export type { FurnaceRecipe, FurnaceFuel, FurnaceSnapshotV1 } from '../gameplay/modules/furnace-candidates';

export { defineStationActionsModule } from '../gameplay/modules/station-actions-module';

export { defineForageModule } from '../gameplay/modules/forage-module';
export type { ForageModuleConfiguration } from '../gameplay/modules/forage-model';

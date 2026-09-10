export { definePack } from './assembly';
export type { ModLifecycleDefinition, ModSystemDefinition } from './lifecycle-contracts';
export type { AuthorizedModuleExecution, ModuleExecutionContext, ModuleInvocationResult } from './authorized-execution';
export type {
  CapabilityContract,
  ModItemAmount,
  ModItemDefinition,
  ModModule,
  ModModuleDescriptor,
  ModRecipeDefinition,
  ModRegistrationFacade,
  ModuleInvocation,
  ModuleInvocationValue,
  ModulePermission,
  PackDefinitionInput,
  PackDependency,
  PackKind,
  PackManifest,
  PackDefinition,
  ProviderSelection,
} from './contracts';

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
export type { FurnaceRecipe, FurnaceFuel, FurnaceSnapshotV1 } from '../gameplay/modules/furnace-candidates';

export { defineStationActionsModule } from '../gameplay/modules/station-actions-module';

export { defineForageModule } from '../gameplay/modules/forage-module';
export type { ForageModuleConfiguration } from '../gameplay/modules/forage-model';

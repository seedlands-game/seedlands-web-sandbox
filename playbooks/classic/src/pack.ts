import { overworldStations } from './stations';
import {
  definePack,
  defineContentModule,
  defineInventoryModule,
  defineInventoryActionsModule,
  defineBlockActionsModule,
  defineStationActionsModule,
  defineForageModule,
  defineBlockRulesModule,
  defineModeModule,
  defineNeedsModule,
  defineCombatModule,
  defineCombatRulesModule,
  defineNeedsRulesModule,
  defineRulesetModule,
  defineRecipeCraftingModule,
  defineBehaviorRegistryModule,
  defineStandardWorldgenModule,
  defineVoxelGeometryModule,
} from '@seedlands/stdlib/mod-api';
import { overworldBlocks, overworldVoxelSemantics } from './blocks';
import { overworldItems } from './items';
import { overworldRecipes } from './recipes';
import { overworldMeleeDefinitions } from './combat';
import { overworldActorProfiles, overworldDefaultPlayerMeleeDefinitionId } from './actors';
import { classicWorldgenProvider } from './worldgen';
import { classicRetiredActorsMigration } from './retired-actors-migration';
import { classicItemInteractionModules } from './item-interactions';
import { classicWoodenDoorGeometryDescriptors } from './structure-descriptors';
import { classicStructureDefinitionModule } from './structures';

const namespaceId = (id: string) => `seedlands:${id}`;
const namespaceStack = <Stack extends Readonly<{ itemId: string }>>(stack: Stack) => ({
  ...stack,
  itemId: namespaceId(stack.itemId),
});

export const pack = definePack({
  id: 'seedlands:overworld',
  version: '1.0.0',
  kind: 'playbook',
  entry: 'overworld.mjs',
  resources: ['playbooks/classic/presentation.json'],
  presentation: { path: 'playbooks/classic/presentation.json' },
  modules: [
    defineStandardWorldgenModule({
      moduleId: 'seedlands:overworld-worldgen',
      provider: classicWorldgenProvider,
    }),
    defineContentModule({
      moduleId: 'seedlands:overworld-content',
      craftingProvider: true,
      items: overworldItems.map((item) => ({ ...item, id: namespaceId(item.id), storageId: item.id })),
      voxels: overworldVoxelSemantics,
      recipes: overworldRecipes.map((recipe) => ({
        ...recipe,
        id: namespaceId(recipe.id),
        storageId: recipe.id,
        inputs: recipe.inputs.map((stack) => ({ ...stack, itemId: namespaceId(stack.itemId) })),
        outputs: recipe.outputs.map((stack) => ({ ...stack, itemId: namespaceId(stack.itemId) })),
      })),
      meleeDefinitions: overworldMeleeDefinitions,
      actorProfiles: overworldActorProfiles.map((profile) => ({
        ...profile,
        ...(profile.deathDrop ? { deathDrop: namespaceStack(profile.deathDrop) } : {}),
      })),
      defaultPlayerMeleeDefinitionId: overworldDefaultPlayerMeleeDefinitionId,
      snapshotMigration: classicRetiredActorsMigration,
      stations: {
        ...overworldStations,
        recipes: overworldStations.recipes.map((recipe) =>
          recipe.kind === 'shaped'
            ? {
                ...recipe,
                pattern: recipe.pattern.map((stack) =>
                  stack ? { ...stack, itemId: namespaceId(stack.itemId) } : null,
                ),
                outputs: recipe.outputs.map((stack) => ({ ...stack, itemId: namespaceId(stack.itemId) })),
              }
            : {
                ...recipe,
                inputs: recipe.inputs.map((stack) => ({ ...stack, itemId: namespaceId(stack.itemId) })),
                outputs: recipe.outputs.map((stack) => ({ ...stack, itemId: namespaceId(stack.itemId) })),
              },
        ),
        furnaceRecipes: overworldStations.furnaceRecipes.map((recipe) => ({
          ...recipe,
          input: { ...recipe.input, itemId: namespaceId(recipe.input.itemId) },
          output: { ...recipe.output, itemId: namespaceId(recipe.output.itemId) },
        })),
        fuels: overworldStations.fuels.map((fuel) => ({ ...fuel, itemId: namespaceId(fuel.itemId) })),
      },
    }),
    defineVoxelGeometryModule({
      moduleId: 'seedlands:overworld-voxel-geometry',
      descriptors: classicWoodenDoorGeometryDescriptors,
    }),
    classicStructureDefinitionModule,
    defineRecipeCraftingModule(),
    defineRulesetModule({ id: 'seedlands:overworld-rules', version: '1.0.0' }),
    defineInventoryModule({ playerLayout: { capacity: 36, hotbarSize: 9 } }),
    defineInventoryActionsModule(),
    defineBehaviorRegistryModule({
      permissions: [
        { resource: 'seedlands.inventory', operations: ['execute'] },
        { resource: 'seedlands.inventory-item', operations: ['execute'] },
        { resource: 'seedlands.combat', operations: ['execute'] },
      ],
    }),
    defineStationActionsModule(),
    defineForageModule({ sourceVoxel: 5, drop: { itemId: 'berry', count: 1 }, intervalSeconds: 120 }),
    defineBlockActionsModule({ stations: true }),
    ...classicItemInteractionModules,
    defineBlockRulesModule({ moduleId: 'seedlands:overworld-block-rules', voxelDefinitions: overworldBlocks }),
    defineModeModule(),
    defineCombatModule(),
    defineCombatRulesModule({
      moduleId: 'seedlands:overworld-combat-rules',
      profile: { damageMultiplier: 1, immuneTargetModes: ['creative'] },
    }),
    defineNeedsModule(),
    defineNeedsRulesModule({
      moduleId: 'seedlands:overworld-needs-rules',
      profiles: {
        satiety: {
          enabledModes: [],
          hungerEverySeconds: 120,
          hungerDelta: 0,
        },
        deficit: { enabledModes: ['survival'], hungerEverySeconds: 5, hungerDelta: 1 },
      },
    }),
  ],
});

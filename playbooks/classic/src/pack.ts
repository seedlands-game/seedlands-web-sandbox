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
  defineFeedingActionsModule,
  defineFeedingRulesModule,
  defineCombatModule,
  defineCombatRulesModule,
  defineNeedsRulesModule,
  defineRulesetModule,
  defineRecipeCraftingModule,
  defineBehaviorRegistryModule,
  defineStandardWorldgenModule,
} from '@seedlands/stdlib/mod-api';
import { overworldBlocks } from './blocks';
import { overworldItems } from './items';
import { overworldRecipes } from './recipes';
import { overworldMeleeDefinitions } from './combat';
import { overworldActorProfiles, overworldDefaultPlayerMeleeDefinitionId, overworldStarterEcology } from './actors';
import { classicWorldgenProvider } from './worldgen';

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
  modules: [
    defineStandardWorldgenModule({
      moduleId: 'seedlands:overworld-worldgen',
      provider: classicWorldgenProvider,
    }),
    defineContentModule({
      moduleId: 'seedlands:overworld-content',
      craftingProvider: true,
      items: overworldItems.map((item) => ({ ...item, id: namespaceId(item.id), storageId: item.id })),
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
      starterEcology: {
        ...overworldStarterEcology,
        initialItem: namespaceStack(overworldStarterEcology.initialItem),
      },
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
    defineRecipeCraftingModule(),
    defineRulesetModule({ id: 'seedlands:overworld-rules', version: '1.0.0' }),
    defineInventoryModule(),
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
    defineBlockRulesModule({ moduleId: 'seedlands:overworld-block-rules', voxelDefinitions: overworldBlocks }),
    defineModeModule(),
    defineCombatModule(),
    defineCombatRulesModule({
      moduleId: 'seedlands:overworld-combat-rules',
      profile: { damageMultiplier: 1, immuneTargetModes: ['creative'] },
    }),
    defineFeedingActionsModule(),
    defineFeedingRulesModule({
      moduleId: 'seedlands:overworld-feeding-rules',
      eligibleArchetypes: ['grazer'],
      deficitThreshold: 50,
      restore: 'full',
    }),
    defineNeedsModule(),
    defineNeedsRulesModule({
      moduleId: 'seedlands:overworld-needs-rules',
      profiles: {
        satiety: {
          enabledModes: ['survival'],
          hungerEverySeconds: 120,
          hungerDelta: -1,
          heal: { threshold: 16, everySeconds: 10, amount: 1, hungerCost: 1 },
          starvation: { threshold: 0, everySeconds: 15, damage: 1 },
        },
        deficit: { enabledModes: ['survival'], hungerEverySeconds: 5, hungerDelta: 1 },
      },
    }),
  ],
});

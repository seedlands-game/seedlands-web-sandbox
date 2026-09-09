import {
  definePack,
  defineContentModule,
  defineInventoryModule,
  defineModeModule,
  defineNeedsModule,
  defineCombatModule,
  defineCombatRulesModule,
  defineNeedsRulesModule,
  defineRulesetModule,
} from '@seedlands/game-core/mod-api';
import { overworldItems } from './items';
import { overworldRecipes } from './recipes';
import { overworldMeleeDefinitions } from './combat';

const namespaceId = (id: string) => `seedlands:${id}`;

export const pack = definePack({
  id: 'seedlands:overworld',
  version: '1.0.0',
  kind: 'playbook',
  entry: 'overworld.mjs',
  modules: [
    defineContentModule({
      moduleId: 'seedlands:overworld-content',
      items: overworldItems.map((item) => ({ ...item, id: namespaceId(item.id), storageId: item.id })),
      recipes: overworldRecipes.map((recipe) => ({
        ...recipe,
        id: namespaceId(recipe.id),
        storageId: recipe.id,
        inputs: recipe.inputs.map((stack) => ({ ...stack, itemId: namespaceId(stack.itemId) })),
        outputs: recipe.outputs.map((stack) => ({ ...stack, itemId: namespaceId(stack.itemId) })),
      })),
      meleeDefinitions: overworldMeleeDefinitions,
    }),
    defineRulesetModule({ id: 'seedlands:overworld-rules', version: '1.0.0' }),
    defineInventoryModule(),
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

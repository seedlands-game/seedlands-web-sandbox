import { definePack, defineContentModule, defineInventoryModule, defineModeModule } from '@seedlands/game-core/mod-api';
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
    defineInventoryModule(),
    defineModeModule(),
  ],
});

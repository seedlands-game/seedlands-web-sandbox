import { definePack, defineCraftingProviderModule } from '@seedlands/stdlib/mod-api';
import { buildingModules } from './building-content';

export const pack = definePack({
  id: 'seedlands:click-conversion',
  version: '1.0.0',
  kind: 'playbook',
  entry: 'click-conversion.mjs',
  modules: [
    ...buildingModules(true),
    defineCraftingProviderModule({
      moduleId: 'sample:clicked-slot-matcher',
      provider: {
        version: 1,
        match({ recipe, slots, selectedSlot }) {
          const stack = slots[selectedSlot];
          return recipe.id === 'click-convert' && stack?.itemId === 'sample:wood' && stack.count >= 1
            ? [{ slot: selectedSlot, count: 1 }]
            : null;
        },
      },
    }),
  ],
});

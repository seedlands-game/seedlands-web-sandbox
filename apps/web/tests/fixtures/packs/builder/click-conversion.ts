import {
  definePack,
  defineCraftingProviderModule,
  defineItemInteractionModule,
  type ModModule,
} from '@seedlands/stdlib/mod-api';
import { buildingModules } from './building-content';

const clickInteractionHandler: ModModule = Object.freeze({
  descriptor: {
    id: 'sample:click-interaction-handler',
    version: '1.0.0',
    permissions: [{ resource: 'seedlands.inventory', operations: ['execute'] }],
  },
  register(api) {
    api.registerOperation({
      id: 'sample:inspect-held-item',
      resource: 'seedlands.inventory',
      run(context, input) {
        return {
          success: true,
          actorId: context.originalActorId,
          targetKind: context.target.kind,
          input: input ?? null,
        };
      },
    });
  },
});

export const pack = definePack({
  id: 'seedlands:click-conversion',
  version: '1.0.0',
  kind: 'playbook',
  entry: 'click-conversion.mjs',
  modules: [
    ...buildingModules(true),
    clickInteractionHandler,
    defineItemInteractionModule({
      moduleId: 'sample:click-item-interactions',
      permissions: [{ resource: 'seedlands.inventory', operations: ['execute'] }],
      definitions: [
        {
          id: 'sample:inspect-wood',
          selector: { itemId: 'sample:wood' },
          trigger: 'self',
          operationId: 'sample:inspect-held-item',
          presentationKey: 'sample:inspect',
        },
      ],
    }),
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

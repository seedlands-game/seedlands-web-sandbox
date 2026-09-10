import {
  defineContentModule,
  defineInventoryModule,
  defineInventoryActionsModule,
  defineBlockActionsModule,
  defineBlockRulesModule,
  defineModeModule,
  defineRulesetModule,
  type ModModule,
} from '@seedlands/game-core/mod-api';

/** Two explicitly declared materials; no import of the default Playbook or its definitions. */
export function buildingModules(withConversion: boolean): ModModule[] {
  return [
    defineContentModule({
      moduleId: 'sample:building-content',
      items: [
        {
          id: 'sample:wood',
          storageId: 'sample:wood',
          name: '原木',
          itemType: 'block',
          stackLimit: 64,
          capabilities: [{ type: 'place', voxel: 4 }],
        },
        {
          id: 'sample:stone',
          storageId: 'sample:stone',
          name: '石块',
          itemType: 'block',
          stackLimit: 64,
          capabilities: [{ type: 'place', voxel: 3 }],
        },
      ],
      recipes: withConversion
        ? [
            {
              id: 'sample:convert',
              storageId: 'click-convert',
              inputs: [{ itemId: 'sample:wood', count: 1 }],
              outputs: [{ itemId: 'sample:stone', count: 2 }],
            },
          ]
        : [],
      meleeDefinitions: [],
      ...(withConversion ? { craftingProvider: true } : {}),
    }),
    defineInventoryModule(),
    defineInventoryActionsModule(),
    defineRulesetModule({ id: 'sample:building-rules', version: '1.0.0' }),
    defineModeModule(),
    defineBlockActionsModule(),
    defineBlockRulesModule({
      moduleId: 'sample:building-blocks',
      voxelDefinitions: [
        { voxel: 0, hardnessSeconds: null, preferredTool: null, drop: null, replaceable: true },
        {
          voxel: 3,
          hardnessSeconds: 0.2,
          preferredTool: null,
          drop: { itemId: 'sample:stone', count: 1 },
          replaceable: false,
        },
        {
          voxel: 4,
          hardnessSeconds: 0.2,
          preferredTool: null,
          drop: { itemId: 'sample:wood', count: 1 },
          replaceable: false,
        },
      ],
    }),
  ];
}

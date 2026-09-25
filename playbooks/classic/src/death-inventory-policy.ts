import { defineDeathInventoryPolicyModuleV1 } from '@seedlands/stdlib/mod-api';

const dropAll = Object.freeze({
  inventory: 'drop' as const,
  cursor: 'drop' as const,
  crafting: 'drop' as const,
  armor: 'drop' as const,
});

export const classicDeathInventoryPolicyModule = defineDeathInventoryPolicyModuleV1({
  moduleId: 'seedlands:overworld-death-inventory-policy',
  definition: {
    version: 1,
    actors: {
      player: { ...dropAll, actor: 'retain' },
      creature: { ...dropAll, actor: 'despawn' },
      npc: { ...dropAll, actor: 'despawn' },
    },
  },
});

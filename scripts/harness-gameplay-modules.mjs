import { resolve } from 'node:path';

export async function compileGameplayModules(root, compileModule, voxelUrl) {
  const itemRegistryUrl = await compileModule(resolve(root, 'src/server/gameplay/item-registry.ts'), {
    "'../../world/voxel'": `'${voxelUrl}'`,
  });
  const voxelGameplayUrl = await compileModule(resolve(root, 'src/server/gameplay/voxel-gameplay.ts'), {
    "'../../world/voxel'": `'${voxelUrl}'`,
    "'./item-registry'": `'${itemRegistryUrl}'`,
  });
  const inventoryUrl = await compileModule(resolve(root, 'src/server/gameplay/inventory.ts'), {
    "'./item-registry'": `'${itemRegistryUrl}'`,
  });
  const playerStateUrl = await compileModule(resolve(root, 'src/server/gameplay/player-state.ts'), {
    "'./inventory'": `'${inventoryUrl}'`,
  });
  const recipeRegistryUrl = await compileModule(resolve(root, 'src/server/gameplay/recipe-registry.ts'), {
    "'./inventory'": `'${inventoryUrl}'`,
    "'./item-registry'": `'${itemRegistryUrl}'`,
  });
  const entityStoreUrl = await compileModule(resolve(root, 'src/server/gameplay/entity-store.ts'), {
    "'./item-registry'": `'${itemRegistryUrl}'`,
  });
  const gameplayRuntimeUrl = await compileModule(resolve(root, 'src/server/gameplay/gameplay-runtime.ts'), {
    "'../../world/voxel'": `'${voxelUrl}'`,
    "'./entity-store'": `'${entityStoreUrl}'`,
    "'./item-registry'": `'${itemRegistryUrl}'`,
    "'./player-state'": `'${playerStateUrl}'`,
    "'./recipe-registry'": `'${recipeRegistryUrl}'`,
    "'./voxel-gameplay'": `'${voxelGameplayUrl}'`,
  });
  const gameServerGameplayUrl = await compileModule(resolve(root, 'src/server/game-server-gameplay.ts'), {
    "'./gameplay/gameplay-runtime'": `'${gameplayRuntimeUrl}'`,
  });
  const gameplayCommandHandlerUrl = await compileModule(
    resolve(root, 'src/server/commands/gameplay-command-handler.ts'),
    {
      "'../gameplay/item-registry'": `'${itemRegistryUrl}'`,
      "'../gameplay/voxel-gameplay'": `'${voxelGameplayUrl}'`,
    },
  );
  return { gameServerGameplayUrl, gameplayCommandHandlerUrl };
}

export function sampleGameplayMetrics(GameServer) {
  const server = new GameServer({ seedText: 'harness-gameplay-metrics' });
  server.spawnPlayer({ id: 'harness-player', position: [0, 32, 0] });
  server.giveItem('harness-player', { itemId: 'wood-block', count: 1 });
  server.craft('harness-player', 'planks');
  server.spawnWorldItem([0, 32, 1], { itemId: 'stone-block', count: 1 });
  server.spawnEntity({ type: 'creature', position: [0, 32, -2] });
  server.queryNearbyEntities([0, 32, 0], 3);
  return server.gameplayMetrics();
}

export const gameplaySummaryLines = (gameplay) => [
  '',
  '## Gameplay foundation',
  '',
  `- Entities: ${gameplay.entityCount}; world items: ${gameplay.worldItemCount}; creatures: ${gameplay.creatureCount}.`,
  `- Nearby buckets/candidates/returned: ${gameplay.nearbyVisitedBucketCount} / ${gameplay.nearbyCandidateCount} / ${gameplay.nearbyReturnedCount}.`,
  `- Inventory operations: ${gameplay.inventoryOperationCount}; gameplay events: ${gameplay.gameplayEventCount}; snapshot: ${gameplay.snapshotBytes} bytes.`,
];

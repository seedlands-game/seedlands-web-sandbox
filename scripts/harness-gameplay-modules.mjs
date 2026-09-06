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
  const poiRegistryUrl = await compileModule(resolve(root, 'src/server/simulation/poi-registry.ts'));
  const groundNavigatorUrl = await compileModule(resolve(root, 'src/server/simulation/ground-navigator.ts'), {
    "'../../world/voxel'": `'${voxelUrl}'`,
  });
  const actionRuntimeUrl = await compileModule(resolve(root, 'src/server/simulation/action-runtime.ts'), {
    "'./ground-navigator'": `'${groundNavigatorUrl}'`,
  });
  const actorStateUrl = await compileModule(resolve(root, 'src/server/simulation/actor-state.ts'));
  const perceptionRuntimeUrl = await compileModule(resolve(root, 'src/server/simulation/perception-runtime.ts'), {
    "'../../world/voxel'": `'${voxelUrl}'`,
  });
  const autonomyRuntimeUrl = await compileModule(resolve(root, 'src/server/simulation/autonomy-runtime.ts'), {
    "'./action-runtime'": `'${actionRuntimeUrl}'`,
    "'./actor-state'": `'${actorStateUrl}'`,
    "'./ground-navigator'": `'${groundNavigatorUrl}'`,
    "'./perception-runtime'": `'${perceptionRuntimeUrl}'`,
    "'./poi-registry'": `'${poiRegistryUrl}'`,
  });
  const gameplaySnapshotUrl = await compileModule(resolve(root, 'src/server/gameplay/gameplay-snapshot.ts'), {
    "'../simulation/autonomy-runtime'": `'${autonomyRuntimeUrl}'`,
    "'./entity-store'": `'${entityStoreUrl}'`,
    "'./player-state'": `'${playerStateUrl}'`,
  });
  const playerOccupancyUrl = await compileModule(resolve(root, 'src/server/gameplay/player-occupancy.ts'));
  const gameplayRuntimeUrl = await compileModule(resolve(root, 'src/server/gameplay/gameplay-runtime.ts'), {
    "'../../world/voxel'": `'${voxelUrl}'`,
    "'../simulation/autonomy-runtime'": `'${autonomyRuntimeUrl}'`,
    "'./entity-store'": `'${entityStoreUrl}'`,
    "'./gameplay-snapshot'": `'${gameplaySnapshotUrl}'`,
    "'./item-registry'": `'${itemRegistryUrl}'`,
    "'./player-state'": `'${playerStateUrl}'`,
    "'./player-occupancy'": `'${playerOccupancyUrl}'`,
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
  const starterEcologyUrl = await compileModule(resolve(root, 'src/server/simulation/starter-ecology.ts'), {
    "'../../world/voxel'": `'${voxelUrl}'`,
  });
  return { gameServerGameplayUrl, gameplayCommandHandlerUrl, starterEcologyUrl };
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

export function sampleAutonomyMetrics(GameServer) {
  const samples = {};
  for (const count of [10, 100, 500]) {
    const server = new GameServer({ seedText: `harness-autonomy-${count}` });
    server.spawnPlayer({ id: 'harness-player', position: [0.5, 32, 0.5] });
    for (let index = 0; index < count; index += 1) {
      const x = (index % 23) * 4 - 44;
      const z = Math.floor(index / 23) * 4 - 44;
      server.spawnAutonomousActor({
        id: `actor-${index}`,
        archetype: index % 10 === 0 ? 'settler' : index % 3 === 0 ? 'night-stalker' : 'grazer',
        position: [x + 0.5, 32, z + 0.5],
      });
    }
    const startedAt = performance.now();
    server.advanceGameplay(1.1);
    samples[count] = { durationMs: performance.now() - startedAt, ...server.simulationMetrics() };
  }
  const bounded = new GameServer({ seedText: 'harness-autonomy-boundary' });
  bounded.spawnPlayer({ id: 'harness-player', position: [0.5, 32, 0.5] });
  let rejectedAt = 0;
  try {
    for (let index = 0; index < 1000; index += 1) {
      bounded.spawnAutonomousActor({
        id: `boundary-${index}`,
        archetype: 'grazer',
        position: [1000 + index, 32, 0.5],
      });
    }
  } catch {
    rejectedAt = bounded.simulationMetrics().retainedActorCount;
  }
  return { samples, requestedActorCount: 1000, rejectedAt, retainedActorLimit: 512 };
}

export const gameplaySummaryLines = (gameplay) => [
  '',
  '## Gameplay foundation',
  '',
  `- Entities: ${gameplay.entityCount}; world items: ${gameplay.worldItemCount}; creatures: ${gameplay.creatureCount}.`,
  `- Nearby buckets/candidates/returned: ${gameplay.nearbyVisitedBucketCount} / ${gameplay.nearbyCandidateCount} / ${gameplay.nearbyReturnedCount}.`,
  `- Inventory operations: ${gameplay.inventoryOperationCount}; gameplay events: ${gameplay.gameplayEventCount}; snapshot: ${gameplay.snapshotBytes} bytes.`,
];

export const autonomySummaryLines = (autonomy) => [
  '',
  '## Creature and NPC simulation',
  '',
  ...Object.entries(autonomy.samples).map(
    ([count, sample]) =>
      `- ${count} actors: ${sample.durationMs.toFixed(2)} ms; active ${sample.activeActorCount}; LOS ${sample.perceptionLineOfSightCheckCount}; navigation ${sample.navigationPlanCount}/${sample.navigationExpandedNodeCount} nodes.`,
  ),
  `- 1000 actor request rejected at ${autonomy.rejectedAt}; retained limit ${autonomy.retainedActorLimit}.`,
];

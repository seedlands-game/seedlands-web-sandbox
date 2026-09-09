import type { GameServer } from '../game-server';
import type { AuthorityGameplayView } from '../../compute/authority-worker-protocol';

export function projectAuthorityGameplayView(server: GameServer, playerId: string): AuthorityGameplayView {
  const entities = server
    .queryEntities()
    .map((entity) =>
      entity.type === 'creature' || entity.type === 'npc'
        ? { ...entity, combat: server.getCombatState(entity.id) }
        : entity,
    );
  return {
    gameplayRevision: server.gameplayRevision,
    gameplayTime: server.gameplayTime,
    player: server.getPlayerState(playerId),
    entities,
    actors: server.simulationSnapshot().actors,
    items: server.itemDefinitions.list(),
    recipes: server.listRecipes(),
    craftableRecipeIds: server.listCraftableRecipes(playerId).map((recipe) => recipe.id),
    metrics: server.gameplayMetrics(),
  };
}

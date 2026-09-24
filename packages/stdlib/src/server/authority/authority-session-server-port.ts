import type { GameServer } from '../game-server';
import type { WorldCommitResult } from '../game-server-types';
import type { AuthorityServerPort } from './authority-session-types';

export function createAuthoritySessionServerPort(
  server: GameServer,
  recordWorldCommit: (commit: WorldCommitResult) => void,
): AuthorityServerPort {
  return {
    get worldRevision() {
      return server.worldRevision;
    },
    get mutationCount() {
      return server.mutationCount;
    },
    get worldTime() {
      return server.worldTime;
    },
    get fluidDiagnostics() {
      return server.fluidDiagnostics;
    },
    getEntity: (id) => {
      const entity = server.getEntity(id);
      return !entity || entity.type === 'station' ? null : { ...entity, type: entity.type };
    },
    getActorModeState: (id) => server.getActorModeState(id),
    createEntityReference: (id) => server.createEntityReference(id),
    resolveEntityReference: (reference) => server.resolveEntityReference(reference) !== null,
    queryEntities: () =>
      server.queryEntities().flatMap((entity) => (entity.type === 'station' ? [] : [{ ...entity, type: entity.type }])),
    updateEntity: (id, update) => server.updateEntityWithoutSnapshot(id, update),
    updateEntities: (updates) => server.updateEntitiesWithoutSnapshot(updates),
    advanceGameplayRules: (seconds) => {
      const result = server.advanceGameplayRules(seconds);
      result.commits.forEach(recordWorldCommit);
      return result;
    },
    gameplayAdvanceCommitUpperBound: (seconds) => server.gameplayAdvanceCommitUpperBound(seconds),
    advanceWorldClock: (hours) => server.advanceClock(hours),
    setPhysicsActiveChunks: (keys) => server.setPhysicsActiveChunks(keys),
    queryPickupTargets: () =>
      server
        .queryEntities({ type: 'player' })
        .filter((entity) => server.getPlayerState(entity.id).lifecycle === 'alive')
        .map((entity) => ({ id: entity.id, position: [...entity.position] })),
    pickupItem: (playerId, itemId) => server.pickupItem(playerId, itemId),
  };
}

import type { WorldAuthorizationPolicy } from '@seedlands/game-core/server/harness/world-authorization';

/** The local world owner may save/restore and pause its world; resident bindings remain self-scoped elsewhere. */
export function browserWorldOwnerPolicy(principalId: string, playerId: string): WorldAuthorizationPolicy {
  return {
    principals: [{ id: principalId, boundEntityId: playerId }],
    rules: [
      {
        effect: 'allow',
        principal: { ids: [principalId] },
        resources: ['world.identity'],
        operations: ['read'],
        scope: 'any',
      },
      {
        effect: 'allow',
        principal: { ids: [principalId] },
        resources: ['world.checkpoint'],
        operations: ['export', 'restore'],
        scope: 'any',
      },
      {
        effect: 'allow',
        principal: { ids: [principalId] },
        resources: ['world.clock'],
        operations: ['read', 'control'],
        scope: 'any',
      },
    ],
  };
}

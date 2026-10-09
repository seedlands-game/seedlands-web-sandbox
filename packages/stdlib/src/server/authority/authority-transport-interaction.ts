import type { GameServer } from '../game-server';
import type { AuthorityInteractActionV1 } from '../gameplay/modules/structure-target-dispatch';
import {
  TRANSPORT_RELATION_CAPABILITY,
  type TransportRelationConfig,
} from '../gameplay/modules/transport-relation-interaction';

/** Transport targets precede held-item fallback only in explicitly configured worlds. */
export function dispatchAuthorityTransportTarget(
  server: GameServer,
  playerId: string,
  action: AuthorityInteractActionV1,
) {
  const composition = server.options.composition;
  if (!composition?.definitionMap.capabilities.some(({ id }) => id === TRANSPORT_RELATION_CAPABILITY)) return null;
  const mount = action.intent === 'use' && action.target.kind === 'entity';
  const dismount = action.intent === 'alternate' && action.target.kind === 'self';
  if (!mount && !dismount) return null;
  if (mount && action.target.kind === 'entity') {
    const entity = server.resolveEntityReference(action.target.reference);
    if (!entity) return { success: false as const, reason: 'stale-target-lifetime' };
    if (entity.type !== 'transport') return null;
  }
  if (dismount && !server.transportProjections().some((entry) => entry.rider?.entityId === playerId)) return null;
  const config = composition.capability<TransportRelationConfig>(TRANSPORT_RELATION_CAPABILITY);
  const result = server.invokeActorModuleOperation(playerId, {
    operationId: config.operationId,
    target: {
      kind: 'entity',
      entityId: mount && action.target.kind === 'entity' ? action.target.reference.entityId : playerId,
    },
    input: {
      version: 1,
      kind: mount ? 'mount' : 'dismount',
      target: mount && action.target.kind === 'entity' ? action.target.reference : null,
      expectedSelection: action.expectedSelection,
    },
  });
  return result.ok
    ? { success: true as const, handled: true as const, value: result.value }
    : { success: false as const, reason: 'transport-rejected', message: result.message };
}

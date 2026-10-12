import type { GameServer } from '../game-server';
import type { AuthorityAction } from '../protocol/authority-worker-protocol';
import { readTransportStorageInputV1 } from '../gameplay/modules/transport-storage-model';
import {
  TRANSPORT_STORAGE_CAPABILITY,
  type TransportStorageConfigV1,
} from '../gameplay/modules/transport-storage-module';

/** The Authority selects the configured operation; clients only submit storage intent. */
export function dispatchAuthorityTransportStorage(
  server: GameServer,
  playerId: string,
  action: Extract<AuthorityAction, { type: 'transport-storage' }>,
) {
  const composition = server.options.composition;
  if (!composition?.definitionMap.capabilities.some(({ id }) => id === TRANSPORT_STORAGE_CAPABILITY))
    return { success: false, reason: 'transport-storage-unavailable' };
  if (action.actor.entityId !== playerId || !server.resolveEntityReference(action.actor))
    return { success: false, reason: 'actor-reference-stale' };
  const input = readTransportStorageInputV1({
    version: action.version,
    actor: action.actor,
    transport: action.transport,
    expectedInventoryRevision: action.expectedInventoryRevision,
    expectedTransportRevision: action.expectedTransportRevision,
    command: action.command,
  });
  const config = composition.capability<TransportStorageConfigV1>(TRANSPORT_STORAGE_CAPABILITY);
  const result = server.invokeActorModuleOperation(playerId, {
    operationId: config.operationId,
    target: { kind: 'entity', entityId: action.transport.entityId },
    input,
  });
  return result.ok
    ? { success: true, value: result.value }
    : { success: false, reason: 'transport-storage-rejected', message: result.message };
}

import { ALL_COMMAND_CAPABILITIES, type CommandSource } from '../commands/command-contract';
import type { AuthorityRuntime } from '../authority/authority-runtime';
import { CHUNK_SIZE, floorDiv } from '../../world/voxel';
import type { WorldInspectRequest } from './world-harness-contract';
import type { WorldAuthorizationRequest, WorldAuthorizationTarget, WorldPrincipal } from './world-authorization';

export const authorizationRequest = (
  resource: WorldAuthorizationRequest['resource'],
  operation: WorldAuthorizationRequest['operation'],
  target: WorldAuthorizationTarget = { kind: 'world' },
): WorldAuthorizationRequest => ({ resource, operation, target });

export const commandSourceForPrincipal = (principal: WorldPrincipal, runtime: AuthorityRuntime): CommandSource => ({
  actorId: principal.boundEntityId ?? runtime.playerId,
  entityId: principal.boundEntityId ?? runtime.playerId,
  sourceType: 'local-developer',
  capabilities: ALL_COMMAND_CAPABILITIES,
});

export const inspectAuthorizationRequest = (request: WorldInspectRequest): WorldAuthorizationRequest => {
  const target: WorldAuthorizationTarget =
    request.kind === 'voxel'
      ? { kind: 'voxel', position: request.position }
      : request.kind === 'chunk'
        ? { kind: 'chunk', chunk: request.chunk }
        : { kind: 'entity', entityId: request.entityId };
  const resource =
    request.kind === 'voxel'
      ? 'world.voxel'
      : request.kind === 'chunk'
        ? 'world.chunk'
        : request.kind === 'entity'
          ? 'world.entity'
          : 'world.actor';
  return authorizationRequest(resource, 'read', target);
};

export const chunkForVoxel = (position: readonly [number, number, number]): readonly [number, number, number] =>
  position.map((coordinate) => floorDiv(coordinate, CHUNK_SIZE)) as [number, number, number];

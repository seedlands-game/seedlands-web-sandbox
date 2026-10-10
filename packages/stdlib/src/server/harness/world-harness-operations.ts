import type { AuthorityWorldOwner } from './authority-world-harness';
import type { WorldFrontier } from './world-harness-contract';
import { ALL_COMMAND_CAPABILITIES, type CommandSource } from '../commands/command-contract';
import type { AuthorityRuntime } from '../authority/authority-runtime';
import { CHUNK_SIZE, chunkKey, floorDiv } from '../../world/voxel';
import type { WorldInspectRequest, WorldInspectResult } from './world-harness-contract';
import type { WorldAuthorizationRequest, WorldAuthorizationTarget, WorldPrincipal } from './world-authorization';
import type { CharacterControlRequest } from '../../runtime/character-control-protocol';
import { validateWorldInspectRequest, integerTuple } from './world-harness-validation';
import { WorldOperationFailure } from './world-harness-state';

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
  if (request.kind === 'column-source') return authorizationRequest('world.chunk', 'read');
  const target: WorldAuthorizationTarget =
    request.kind === 'voxel'
      ? { kind: 'voxel', position: request.position }
      : request.kind === 'chunk'
        ? { kind: 'chunk', chunk: request.chunk }
        : request.kind === 'entity-reference'
          ? { kind: 'entity', entityId: request.reference.entityId }
          : { kind: 'entity', entityId: request.entityId };
  const resource =
    request.kind === 'voxel'
      ? 'world.voxel'
      : request.kind === 'chunk'
        ? 'world.chunk'
        : request.kind === 'entity' || request.kind === 'entity-reference'
          ? 'world.entity'
          : 'world.actor';
  return authorizationRequest(resource, 'read', target);
};

export type CapturedWorldInspectRequest =
  Readonly<{ ok: true; request: WorldInspectRequest }> | Readonly<{ ok: false; cause: unknown }>;

export function captureWorldInspectRequest(request: unknown): CapturedWorldInspectRequest {
  try {
    return { ok: true, request: validateWorldInspectRequest(request) };
  } catch (cause) {
    return { ok: false, cause };
  }
}

const requireCapturedInspectRequest = (captured: CapturedWorldInspectRequest): WorldInspectRequest => {
  if (!captured.ok) throw captured.cause;
  return captured.request;
};

export const describeWorldInspect = (captured: CapturedWorldInspectRequest) => {
  const request = requireCapturedInspectRequest(captured);
  return { name: `inspect:${request.kind}`, authorization: inspectAuthorizationRequest(request) };
};

export function executeWorldInspect(
  owner: AuthorityWorldOwner,
  captured: CapturedWorldInspectRequest,
): WorldInspectResult {
  const request = requireCapturedInspectRequest(captured);
  if (request.kind === 'column-source')
    throw new TypeError('Column source inspection requires asynchronous publication.');
  const server = owner.runtime.server;
  if (request.kind === 'entity-reference') {
    if (!server.resolveEntityReference) throw new Error('Entity reference resolution is unavailable.');
    return {
      kind: 'entity-reference',
      reference: { ...request.reference },
      status: server.resolveEntityReference(request.reference) ? 'current' : 'stale',
    };
  }
  if (request.kind === 'entity') {
    const entity = server.getEntity(request.entityId);
    if (!entity) throw new WorldOperationFailure('WORLD_ENTITY_UNAVAILABLE', 'Entity is unavailable.', 'unavailable');
    return { kind: 'entity', entity };
  }
  if (request.kind === 'actor') {
    const actor = server.getActorState(request.entityId);
    if (!actor) throw new WorldOperationFailure('WORLD_ACTOR_UNAVAILABLE', 'Actor is unavailable.', 'unavailable');
    return { kind: 'actor', actor };
  }
  if (request.kind === 'voxel') {
    if (!integerTuple(request.position)) throw new TypeError('Voxel position must contain three integers.');
    const loaded = server.peekLoadedVoxel(...request.position);
    if (!loaded)
      throw new WorldOperationFailure(
        'WORLD_CHUNK_UNPREPARED',
        'Voxel inspection does not implicitly generate unknown terrain.',
        'unavailable',
      );
    return { kind: 'voxel', position: request.position, voxel: loaded.voxel, chunkRevision: loaded.revision };
  }
  if (!integerTuple(request.chunk)) throw new TypeError('Chunk position must contain three integers.');
  const key = chunkKey(...request.chunk);
  const baseline = server.readCollisionBaseline(key, 0);
  if (baseline.status === 'unavailable')
    throw new WorldOperationFailure(
      'WORLD_CHUNK_UNPREPARED',
      'Chunk inspection does not implicitly generate unknown terrain.',
      'unavailable',
    );
  const chunk = server.getChunk(...request.chunk);
  return {
    kind: 'chunk',
    chunk: request.chunk,
    key,
    revision: chunk.revision,
    materialized: chunk.materialized,
  };
}

export const characterHarnessOperation = (request: CharacterControlRequest) => {
  if (!request || typeof request !== 'object' || typeof request.kind !== 'string')
    throw new TypeError('Character request is invalid.');
  const operation =
    request.kind === 'create' || request.kind === 'behavior'
      ? 'write'
      : request.kind === 'dialogue' || request.kind === 'speak' || request.kind === 'intent'
        ? 'execute'
        : request.kind === 'memory'
          ? 'write'
          : 'read';
  const target =
    request.kind === 'create' || request.kind === 'list' || (request.kind === 'capabilities' && !request.entityId)
      ? ({ kind: 'world' } as const)
      : ({ kind: 'entity', entityId: request.entityId! } as const);
  return {
    name: `character:${request.kind}`,
    authorization: authorizationRequest('world.character', operation, target),
  };
};

export const chunkForVoxel = (position: readonly [number, number, number]): readonly [number, number, number] =>
  position.map((coordinate) => floorDiv(coordinate, CHUNK_SIZE)) as [number, number, number];

export function worldFrontierFor(owner: AuthorityWorldOwner): WorldFrontier {
  const snapshot = owner.runtime.snapshot();
  return {
    worldId: owner.worldId,
    epoch: owner.epoch,
    worldRevision: snapshot.worldRevision,
    commitSequence: snapshot.commitSequence,
    physicsTick: snapshot.physicsTick,
    fluidWorkSequence: owner.runtime.settlementDiagnostics.fluidIssuedWorkCount,
    logicObservationSequence: owner.runtime.settlementDiagnostics.logicIssuedObservationSequence,
  };
}

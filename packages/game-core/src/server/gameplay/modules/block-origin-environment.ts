import { assertActorResourceExecution } from '../../composition/secondary-resource-authorization';
import type { WorldComposition } from '../../composition/contracts';
import type { ModuleActorAuthority } from '../../composition/gameplay-actor-authority';
import type { RegisteredCommitContext } from '../../composition/operation-contracts';
import {
  captureDurableExecutionOrigin,
  rebindDurableExecutionOrigin,
  type DurableExecutionOriginV1,
} from '../../composition/execution-origin';
import type { EntityIdentityPort } from '../../simulation/action-identity';
import type { EntityStore } from '../entity-store';

const ACTOR_RESOURCE = 'seedlands.block-actor';
const VOXEL_RESOURCE = 'seedlands.block-voxel';
export class BlockOriginUnavailable extends TypeError {}

/** A running break retains a subject/lifetime, never a principal grant or a host closure. */
export function createBlockOriginEnvironment(
  options: Readonly<{
    composition: WorldComposition;
    entities: EntityStore;
    actorAuthority?: ModuleActorAuthority;
  }>,
) {
  const identity: EntityIdentityPort = {
    referenceFor: (id) => options.entities.createReference(id),
    resolve: (reference) => options.entities.resolveReference(reference)?.id ?? null,
    rebind: (reference) => {
      const current = options.entities.createReference(reference.entityId);
      return current?.lifetime === reference.lifetime ? current : null;
    },
  };
  const resolve = (origin: DurableExecutionOriginV1, position: readonly [number, number, number]) => {
    const entity = options.entities.get(origin.originalActor.entityId);
    const binding = entity && options.actorAuthority?.resolveOrigin(origin, entity.type);
    if (!binding || entity?.type !== 'player')
      throw new BlockOriginUnavailable('Block origin has no current host authority.');
    const target = { kind: 'voxel' as const, position };
    let rebound: ReturnType<typeof rebindDurableExecutionOrigin>;
    try {
      rebound = rebindDurableExecutionOrigin({
        composition: options.composition,
        identity,
        authorizer: binding.authorizer,
        origin,
        request: { resource: VOXEL_RESOURCE, operation: 'execute', target },
      });
      assertActorResourceExecution(options.composition, binding.authorizer, rebound.context, ACTOR_RESOURCE);
    } catch (error) {
      if (error instanceof TypeError) throw new BlockOriginUnavailable(error.message);
      throw error;
    }
    for (const request of [
      {
        resource: ACTOR_RESOURCE,
        operation: 'read' as const,
        target: { kind: 'entity' as const, entityId: entity.id },
      },
      { resource: VOXEL_RESOURCE, operation: 'read' as const, target },
    ]) {
      if (!binding.authorizer.authorize(binding.principalId, request).allowed)
        throw new BlockOriginUnavailable('Current Block observation permission denied.');
    }
    return { ...binding, rebound };
  };
  return Object.freeze({
    resolve,
    capture(execution: RegisteredCommitContext) {
      const context = execution.context;
      if (context.kind !== 'actor' || context.target.kind !== 'voxel' || execution.resource !== VOXEL_RESOURCE)
        throw new TypeError('Durable Block origin requires an authorized actor voxel operation.');
      const origin = captureDurableExecutionOrigin({
        composition: options.composition,
        authorizer: execution.authorizer,
        identity,
        binding: {
          moduleId: context.provenance.moduleId,
          principalId: context.principal.id,
          originalActorId: context.originalActorId,
        },
        request: { resource: VOXEL_RESOURCE, operation: 'execute', target: context.target },
      });
      resolve(origin, context.target.position);
      return origin;
    },
  });
}

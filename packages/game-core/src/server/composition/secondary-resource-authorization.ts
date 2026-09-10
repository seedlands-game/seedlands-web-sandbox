import type { WorldComposition } from './contracts';
import type { ActorModuleExecutionContext } from './authorized-execution';
import type { WorldResourceAuthorizer } from '../harness/world-authorization';

/** A permitted primary target and read-only actor projection do not authorize actor effects. */
export function assertActorResourceExecution(
  composition: WorldComposition,
  authorizer: WorldResourceAuthorizer,
  context: ActorModuleExecutionContext,
  resource: string,
): void {
  const decision = authorizer.authorize(context.principal.id, {
    resource,
    operation: 'execute',
    target: { kind: 'entity', entityId: context.originalActorId },
  });
  if (!decision.allowed) throw new TypeError(`Actor execution permission denied: ${resource}.`);
  const module = composition.moduleBindings[context.provenance.moduleId];
  if (
    !module?.permissions.some(
      (permission) => permission.resource === resource && permission.operations.includes('execute'),
    )
  )
    throw new TypeError(`Module actor execution permission denied: ${resource}.`);
}

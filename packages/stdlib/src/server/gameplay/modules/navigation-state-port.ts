import type { WorldComposition } from '../../composition/contracts';
import type { RegisteredStatePort } from '../../composition/operation-contracts';
import { assertActorResourceExecution } from '../../composition/secondary-resource-authorization';
import {
  NAVIGATION_COMPONENT,
  NAVIGATION_RESOURCE,
  navigationAddress,
  buildNavigationCandidate,
  type NavigationObservationV1,
  type NavigationCandidateV1,
  type NavigationInteractionConfig,
} from './navigation-interaction-model';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function createNavigationStatePort(
  owner: Readonly<{
    config?: NavigationInteractionConfig;
    composition?: WorldComposition;
    revision(): number;
    lifetime(): object;
    actorLifetime(actorId: string): unknown;
    project(actorId: string): NavigationObservationV1;
    assertCanChange(): void;
    accept(candidate: NavigationCandidateV1): void;
  }>,
): RegisteredStatePort {
  const actor = (address: Parameters<RegisteredStatePort['read']>[0]) => {
    if (
      address.componentId !== NAVIGATION_COMPONENT ||
      address.target.kind !== 'entity' ||
      address.partition !== undefined
    )
      throw new TypeError('Navigation state address is invalid.');
    return address.target.entityId;
  };
  const read: RegisteredStatePort['read'] = (address) => ({
    revision: owner.revision(),
    value: owner.project(actor(address)),
  });
  return Object.freeze({
    read,
    prepareCommit(observed, writes, execution) {
      const { config, composition } = owner;
      const context = execution.context;
      if (
        !config ||
        !composition ||
        context.kind !== 'actor' ||
        context.target.kind !== 'entity' ||
        context.target.entityId !== context.originalActorId ||
        execution.operationId !== config.operationId ||
        execution.resource !== NAVIGATION_RESOURCE
      )
        throw new TypeError('Navigation commit requires its registered actor operation.');
      const id = context.originalActorId,
        address = navigationAddress(id),
        revision = owner.revision(),
        lifetime = owner.lifetime();
      if (
        observed.length !== 1 ||
        writes.length !== 1 ||
        !same(observed[0]!.address, address) ||
        !same(writes[0]!.address, address) ||
        observed[0]!.revision !== revision
      )
        throw new Error('navigation-observation-stale');
      const projection = owner.project(id);
      const actorLifetime = owner.actorLifetime(id);
      if (!actorLifetime || !Number.isSafeInteger(revision + 1)) throw new Error('navigation-owner-unavailable');
      const candidate = buildNavigationCandidate(projection, config.policy, execution.effectiveInput);
      if (!same(execution.candidateValue, candidate) || !same(writes[0]!.value, candidate))
        throw new Error('navigation-candidate-stale');
      let used = false,
        validated = false;
      const validate = () => {
        validated = false;
        if (
          used ||
          owner.lifetime() !== lifetime ||
          owner.revision() !== revision ||
          !same(owner.actorLifetime(id), actorLifetime) ||
          !same(owner.project(id), projection)
        )
          throw new Error('navigation-observation-stale');
        assertActorResourceExecution(composition, execution.authorizer, context, NAVIGATION_RESOURCE);
        owner.assertCanChange();
        validated = true;
      };
      return {
        ok: true,
        revision: revision + 1,
        value: candidate,
        validate,
        apply() {
          if (!validated || used) throw new Error('Navigation commit has not been validated.');
          validate();
          used = true;
          owner.accept(candidate);
        },
      };
    },
    commit() {
      return { ok: false, reason: 'Navigation requires a prepared registered commit.' };
    },
  } satisfies RegisteredStatePort);
}

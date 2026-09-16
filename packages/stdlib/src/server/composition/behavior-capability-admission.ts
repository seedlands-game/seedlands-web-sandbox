import {
  BEHAVIOR_MAX_OPERATION_ID_LENGTH,
  BEHAVIOR_MAX_REQUIRED_OPERATIONS,
  type BehaviorCapability,
  type BehaviorOperationRequirement,
} from '../../runtime/behavior-control-protocol';
import type { ModDefinitionCatalog, ModRegistrationIdentity } from './contracts';

export function validateBehaviorOperationRequirements(
  value: unknown,
  capabilityId: string,
): asserts value is readonly BehaviorOperationRequirement[] {
  if (!Array.isArray(value) || value.length > BEHAVIOR_MAX_REQUIRED_OPERATIONS)
    throw new TypeError(`Behavior ${capabilityId} required operations are invalid.`);
  const ids = new Set<string>();
  for (const requirement of value) {
    if (
      !requirement ||
      typeof requirement !== 'object' ||
      typeof (requirement as BehaviorOperationRequirement).operationId !== 'string' ||
      (requirement as BehaviorOperationRequirement).operationId.length > BEHAVIOR_MAX_OPERATION_ID_LENGTH ||
      !/^[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._/-]*$/.test((requirement as BehaviorOperationRequirement).operationId) ||
      !['self', 'any'].includes((requirement as BehaviorOperationRequirement).authorization)
    )
      throw new TypeError(`Behavior ${capabilityId} required operation is invalid.`);
    const id = (requirement as BehaviorOperationRequirement).operationId;
    if (ids.has(id)) throw new TypeError(`Behavior ${capabilityId} required operation is duplicated: ${id}`);
    ids.add(id);
  }
}

export function snapshotBehaviorOperationRequirements(
  requirements: readonly BehaviorOperationRequirement[],
): readonly BehaviorOperationRequirement[] {
  return Object.freeze(requirements.map((entry) => Object.freeze({ ...entry })));
}

export function assertBehaviorProviderAdmission(
  definitions: ModDefinitionCatalog,
  identity: ModRegistrationIdentity,
  capability: BehaviorCapability,
): void {
  const provider = definitions.module(identity.moduleId);
  if (!provider) throw new TypeError(`Behavior provider module is missing: ${identity.moduleId}`);
  for (const requirement of capability.requiredOperations) {
    const operation = definitions.operation(requirement.operationId);
    if (!operation)
      throw new TypeError(`Behavior ${capability.id} required operation is missing: ${requirement.operationId}`);
    if (operation.executionKind !== 'actor')
      throw new TypeError(
        `Behavior ${capability.id} required operation is not actor-executable: ${requirement.operationId}`,
      );
    const owner = definitions.module(operation.moduleId);
    if (
      !owner?.permissions.some(
        (permission) => permission.resource === operation.resource && permission.operations.includes('execute'),
      )
    )
      throw new TypeError(
        `Behavior ${capability.id} required operation owner has no execute permission: ${requirement.operationId}`,
      );
    if (
      !provider.permissions.some(
        (permission) => permission.resource === operation.resource && permission.operations.includes('execute'),
      )
    )
      throw new TypeError(
        `Behavior ${capability.id} provider has no execute permission for required operation: ${requirement.operationId}`,
      );
  }
}

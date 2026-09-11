import type { ActorModuleExecutionContext } from './authorized-execution';
import type { WorldComposition } from './contracts';
import type { RegisteredActorOperationBinding } from './operation-contracts';
import type {
  WorldAuthorizationRequest,
  WorldAuthorizationTarget,
  WorldPrincipal,
  WorldResourceAuthorizer,
} from '../harness/world-authorization';
import {
  isEntityLifetimeReference,
  type EntityIdentityPort,
  type EntityLifetimeReference,
} from '../simulation/action-identity';

const MAX_IDENTITY_LENGTH = 256;

export type DurableExecutionOriginV1 = Readonly<{
  version: 1;
  principalSubject: string;
  provenance: Readonly<{ packId: string; moduleId: string }>;
  originalActor: Readonly<{ entityId: string; lifetime: number }>;
}>;

export type ReboundExecutionOrigin = Readonly<{
  binding: RegisteredActorOperationBinding;
  actorReference: EntityLifetimeReference;
  context: ActorModuleExecutionContext;
}>;

export type ExecutionOriginEnvironment = Readonly<{
  composition: WorldComposition;
  authorizer: WorldResourceAuthorizer;
  identity: EntityIdentityPort;
  request: WorldAuthorizationRequest;
}>;

export type CaptureDurableExecutionOriginInput = ExecutionOriginEnvironment &
  Readonly<{ binding: RegisteredActorOperationBinding }>;
export type RebindDurableExecutionOriginInput = ExecutionOriginEnvironment &
  Readonly<{ origin: DurableExecutionOriginV1 }>;

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  if (Reflect.ownKeys(value).length !== keys.length) return false;
  return keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return Boolean(descriptor?.enumerable && 'value' in descriptor);
  });
};

const boundedIdentity = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_IDENTITY_LENGTH || value.trim() !== value)
    throw new TypeError(`${label} is invalid.`);
  return value;
};

const freezeTarget = (target: WorldAuthorizationTarget): WorldAuthorizationTarget => {
  if (target.kind === 'chunk')
    return Object.freeze({ kind: 'chunk', chunk: Object.freeze([...target.chunk]) }) as WorldAuthorizationTarget;
  if (target.kind === 'voxel')
    return Object.freeze({
      kind: 'voxel',
      position: Object.freeze([...target.position]),
    }) as WorldAuthorizationTarget;
  return Object.freeze({ ...target });
};

const validateProvenance = (
  composition: WorldComposition,
  provenance: Readonly<{ packId: string; moduleId: string }>,
) => {
  const binding = composition.moduleBindings[provenance.moduleId];
  const packExists = composition.definitionMap.packs.some((pack) => pack.id === provenance.packId);
  const module = composition.definitionMap.modules.find((candidate) => candidate.id === provenance.moduleId);
  if (!packExists || !module || module.packId !== provenance.packId || binding?.packId !== provenance.packId)
    throw new TypeError(`Unknown or stale execution provenance: ${provenance.packId}/${provenance.moduleId}`);
  return binding;
};

const assertActorPrincipal = (principal: WorldPrincipal, originalActorId: string): void => {
  if (principal.kind === 'system') throw new TypeError('System principal cannot be a durable actor origin.');
  if (principal.boundEntityId !== undefined && principal.boundEntityId !== originalActorId)
    throw new TypeError('Original actor does not match the host-bound principal.');
};

const currentActorReference = (
  identity: EntityIdentityPort,
  entityId: string,
  savedLifetime?: number,
): EntityLifetimeReference => {
  const reference = identity.referenceFor(entityId);
  if (!reference || !isEntityLifetimeReference(reference) || reference.entityId !== entityId)
    throw new TypeError('Original actor binding is missing or invalid.');
  if (savedLifetime !== undefined && reference.lifetime !== savedLifetime)
    throw new TypeError('Original actor lifetime does not match the durable execution origin.');
  if (identity.resolve(reference) !== entityId) throw new TypeError('Original actor current binding is invalid.');
  return Object.freeze({ ...reference });
};

const assertCurrentAuthorization = (
  composition: WorldComposition,
  authorizer: WorldResourceAuthorizer,
  principalId: string,
  moduleId: string,
  request: WorldAuthorizationRequest,
): WorldPrincipal => {
  const decision = authorizer.authorize(principalId, request);
  if (!decision.allowed) throw new TypeError(`Current world permission denied: ${decision.message}`);
  const binding = composition.moduleBindings[moduleId];
  const permission = binding?.permissions.find((candidate) => candidate.resource === request.resource);
  if (!permission?.operations.includes(request.operation))
    throw new TypeError('Current module permission denied for durable execution origin.');
  return decision.principal;
};

export function validateDurableExecutionOrigin(value: unknown): DurableExecutionOriginV1 {
  if (!isPlainRecord(value) || !hasExactKeys(value, ['version', 'principalSubject', 'provenance', 'originalActor']))
    throw new TypeError('Durable execution origin shape is invalid.');
  if (value.version !== 1) throw new TypeError('Durable execution origin version is invalid.');
  const principalSubject = boundedIdentity(value.principalSubject, 'Durable execution principal subject');
  if (!isPlainRecord(value.provenance) || !hasExactKeys(value.provenance, ['packId', 'moduleId']))
    throw new TypeError('Durable execution provenance is invalid.');
  const packId = boundedIdentity(value.provenance.packId, 'Durable execution pack identity');
  const moduleId = boundedIdentity(value.provenance.moduleId, 'Durable execution module identity');
  if (!isPlainRecord(value.originalActor) || !hasExactKeys(value.originalActor, ['entityId', 'lifetime']))
    throw new TypeError('Durable execution original actor is invalid.');
  const entityId = boundedIdentity(value.originalActor.entityId, 'Durable execution actor identity');
  if (!Number.isSafeInteger(value.originalActor.lifetime) || (value.originalActor.lifetime as number) < 0)
    throw new TypeError('Durable execution actor lifetime is invalid.');
  return Object.freeze({
    version: 1,
    principalSubject,
    provenance: Object.freeze({ packId, moduleId }),
    originalActor: Object.freeze({ entityId, lifetime: value.originalActor.lifetime as number }),
  });
}

export function captureDurableExecutionOrigin(input: CaptureDurableExecutionOriginInput): DurableExecutionOriginV1 {
  const moduleBinding = validateProvenance(input.composition, {
    packId: input.composition.moduleBindings[input.binding.moduleId]?.packId ?? '',
    moduleId: input.binding.moduleId,
  });
  const principal = input.authorizer.principal(input.binding.principalId);
  if (!principal) throw new TypeError(`Unknown current world principal: ${input.binding.principalId}`);
  if (!principal.subject) throw new TypeError('Current world principal has no durable subject.');
  assertActorPrincipal(principal, input.binding.originalActorId);
  const actorReference = currentActorReference(input.identity, input.binding.originalActorId);
  assertCurrentAuthorization(
    input.composition,
    input.authorizer,
    input.binding.principalId,
    input.binding.moduleId,
    input.request,
  );
  return validateDurableExecutionOrigin({
    version: 1,
    principalSubject: principal.subject,
    provenance: { packId: moduleBinding.packId, moduleId: input.binding.moduleId },
    originalActor: { entityId: input.binding.originalActorId, lifetime: actorReference.lifetime },
  });
}

export function rebindDurableExecutionOrigin(input: RebindDurableExecutionOriginInput): ReboundExecutionOrigin {
  const origin = validateDurableExecutionOrigin(input.origin);
  validateProvenance(input.composition, origin.provenance);
  const principal = input.authorizer.principalForSubject(origin.principalSubject);
  if (!principal) throw new TypeError(`No current world principal maps durable subject: ${origin.principalSubject}`);
  assertActorPrincipal(principal, origin.originalActor.entityId);
  const actorReference = currentActorReference(
    input.identity,
    origin.originalActor.entityId,
    origin.originalActor.lifetime,
  );
  const authorizedPrincipal = assertCurrentAuthorization(
    input.composition,
    input.authorizer,
    principal.id,
    origin.provenance.moduleId,
    input.request,
  );
  const target = freezeTarget(input.request.target);
  const provenance = Object.freeze({ ...origin.provenance });
  return Object.freeze({
    binding: Object.freeze({
      moduleId: origin.provenance.moduleId,
      principalId: principal.id,
      originalActorId: origin.originalActor.entityId,
    }),
    actorReference,
    context: Object.freeze({
      kind: 'actor',
      principal: authorizedPrincipal,
      originalActorId: origin.originalActor.entityId,
      provenance,
      target,
    }),
  });
}

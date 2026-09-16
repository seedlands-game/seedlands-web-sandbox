import {
  BEHAVIOR_MAX_BYTES,
  BEHAVIOR_MAX_CAPABILITIES,
  BEHAVIOR_MAX_CAPABILITY_STATE_BYTES,
  BEHAVIOR_MAX_DEPTH,
  BEHAVIOR_MAX_NODES,
  BEHAVIOR_SCHEMA_VERSION,
  type BehaviorArgumentRule,
  type BehaviorArguments,
  type BehaviorCapability,
  type BehaviorCondition,
  type BehaviorDefinition,
  type BehaviorJson,
  type BehaviorNode,
  type BehaviorOperationRequirement,
  type BehaviorSkillCheckpoint,
} from '../../runtime/behavior-control-protocol';
import {
  assertBehaviorCapabilityDescriptor,
  isBehaviorCapabilityCatalog,
} from '../../runtime/behavior-capability-descriptor';
import type { ModDefinitionCatalog, ModRegistrationIdentity } from './contracts';
import type { RegisteredOperationRequest, RegisteredOperationResult } from './operation-contracts';
import {
  behaviorJsonBytes,
  behaviorObject,
  frozenBehaviorValue,
  validateBehaviorArgumentRule,
  validateBehaviorArguments,
} from './behavior-capability-validation';
import {
  assertBehaviorProviderContext,
  withBehaviorProviderContext,
  normalizeBehaviorProviderResult,
  snapshotBehaviorProvider,
  validateBehaviorProviderState,
  type RegisteredBehaviorProvider,
} from './behavior-capability-dispatch';
import {
  assertBehaviorProviderAdmission,
  snapshotBehaviorOperationRequirements,
  validateBehaviorOperationRequirements,
} from './behavior-capability-admission';

export const BEHAVIOR_REGISTRY_CAPABILITY = 'seedlands:behavior-registry',
  STANDARD_BEHAVIOR_PROVIDER_MODULE_ID = 'seedlands:behavior-registry-module';

export type BehaviorProviderOrigin = Readonly<{
  moduleId: string;
  providerId: string;
  providerVersion: string;
}>;
export type BehaviorActorSnapshot = Readonly<{
  reference: Readonly<{ entityId: string; epoch: number; lifetime: number }>;
  lifecycle: 'alive' | 'dead';
  controlSource: 'player' | 'autonomous' | 'behavior' | 'none';
  health: number;
  maxHealth: number;
  needs: Readonly<{ hunger: number; maxHunger: number; hungerMeaning: 'satiety' | 'deficit' }>;
  inventory: Readonly<{
    slots: readonly BehaviorJson[];
    selectedSlot: number;
    revision: number;
  }>;
}>;
export type BehaviorConditionContext = Readonly<{
  actor: Readonly<{
    entityId: string;
    epoch: number;
    lifetime: number;
    behaviorRevision: number;
    activation: number;
  }>;
  actorState: BehaviorActorSnapshot;
  deltaSeconds: number;
  elapsedSeconds: number;
}>;
export type BehaviorProviderContext = BehaviorConditionContext &
  Readonly<{
    /** Resolves only a currently authorized observation reference; raw entity ids are not accepted. */
    resolveTarget(reference: string): Readonly<{ entityId: string; epoch: number; lifetime: number }> | null;
    /** The registry binds this invocation to the selected provider before the host authorizes it. */
    invoke(request: RegisteredOperationRequest): RegisteredOperationResult;
  }>;
export type BehaviorRuntimeContext = BehaviorConditionContext &
  Readonly<{
    invoke(origin: BehaviorProviderOrigin, request: RegisteredOperationRequest): RegisteredOperationResult;
    resolveTarget(reference: string): Readonly<{ entityId: string; epoch: number; lifetime: number }> | null;
    allows(capability: BehaviorCapability): boolean;
    standard: BehaviorStandardDispatcher;
  }>;

type CapabilityBase = Readonly<{
  id: string;
  version: string;
  description: string;
  arguments: Readonly<Record<string, BehaviorArgumentRule>>;
}>;
export type BehaviorConditionProviderDefinition = CapabilityBase &
  Readonly<{
    kind: 'condition';
    evaluate(context: BehaviorConditionContext, args: BehaviorArguments): boolean;
  }>;
export type BehaviorSkillRunning = Readonly<{ status: 'running'; phase: string; state: BehaviorJson }>;
export type BehaviorSkillTerminal =
  | Readonly<{ status: 'succeeded'; phase: string; result?: BehaviorJson }>
  | Readonly<{ status: 'failed'; phase?: string; reason: string }>
  | Readonly<{ status: 'cancelled'; phase?: string }>;
export type BehaviorSkillProviderResult = BehaviorSkillRunning | BehaviorSkillTerminal;
export type BehaviorStandardDispatcher = Readonly<{
  evaluate(id: string, args: BehaviorArguments): boolean;
  start(
    id: string,
    args: BehaviorArguments,
    port: Pick<BehaviorProviderContext, 'invoke' | 'resolveTarget'>,
  ): BehaviorSkillProviderResult;
  continue(
    id: string,
    args: BehaviorArguments,
    state: BehaviorJson,
    port: Pick<BehaviorProviderContext, 'invoke' | 'resolveTarget'>,
  ): BehaviorSkillProviderResult;
  cancel(
    id: string,
    args: BehaviorArguments,
    state: BehaviorJson,
    reason: string,
    port: Pick<BehaviorProviderContext, 'invoke' | 'resolveTarget'>,
  ): Extract<BehaviorSkillProviderResult, { status: 'cancelled' | 'failed' }>;
}>;
export type BehaviorSkillProviderDefinition = CapabilityBase &
  Readonly<{
    kind: 'skill';
    requiredOperations: readonly BehaviorOperationRequirement[];
    state: Readonly<{ version: string; maximumBytes: number; validate?(value: BehaviorJson): boolean }>;
    start(context: BehaviorProviderContext, args: BehaviorArguments): BehaviorSkillProviderResult;
    continue(
      context: BehaviorProviderContext,
      args: BehaviorArguments,
      state: BehaviorJson,
    ): BehaviorSkillProviderResult;
    cancel?(
      context: BehaviorProviderContext,
      args: BehaviorArguments,
      state: BehaviorJson,
      reason: string,
    ): Extract<BehaviorSkillProviderResult, { status: 'cancelled' | 'failed' }>;
  }>;
export type BehaviorProviderDefinition = BehaviorConditionProviderDefinition | BehaviorSkillProviderDefinition;

export type BehaviorCapabilityRegistry = Readonly<{
  register(identity: ModRegistrationIdentity, definition: BehaviorProviderDefinition): void;
  freeze(definitions: ModDefinitionCatalog): void;
  /** World-level authoring catalog. It does not establish authority for an actor execution. */
  catalog(): readonly BehaviorCapability[];
  /** Actor-bound executable catalog. A stale, dead, or non-behavior binding discovers no capabilities. */
  catalogForActor(
    binding: Readonly<{ entityId: string; epoch: number; lifetime: number }>,
    actorState: BehaviorActorSnapshot | null,
    allowed: (capability: BehaviorCapability) => boolean,
  ): readonly BehaviorCapability[];
  validateDefinition(definition: BehaviorDefinition): void;
  validateDefinitionForActor(
    definition: BehaviorDefinition,
    allowed: (capability: BehaviorCapability) => boolean,
  ): void;
  evaluate(id: string, context: BehaviorRuntimeContext, args?: BehaviorArguments): boolean;
  start(id: string, context: BehaviorRuntimeContext, args?: BehaviorArguments): BehaviorSkillProviderResult;
  continue(
    id: string,
    context: BehaviorRuntimeContext,
    args: BehaviorArguments | undefined,
    state: BehaviorJson,
  ): BehaviorSkillProviderResult;
  cancel(
    id: string,
    context: BehaviorRuntimeContext,
    args: BehaviorArguments | undefined,
    state: BehaviorJson,
    reason: string,
  ): Extract<BehaviorSkillProviderResult, { status: 'cancelled' | 'failed' }>;
  checkpoint(id: string, state: BehaviorJson): BehaviorSkillCheckpoint;
  assertRestorable(checkpoint: BehaviorSkillCheckpoint): void;
}>;

type RegisteredProvider = RegisteredBehaviorProvider;

const IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const NAMESPACE_ID = /^[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._/-]*$/;
const EXACT_VERSION =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const providerKey = (kind: BehaviorProviderDefinition['kind'], id: string) => `${kind}:${id}`;

export function createBehaviorCapabilityRegistry(): BehaviorCapabilityRegistry {
  const providers = new Map<string, RegisteredProvider>();
  const capabilityIds = new Set<string>();
  let frozen = false;
  let catalog: readonly BehaviorCapability[] = Object.freeze([]);

  const requireProvider = (kind: BehaviorProviderDefinition['kind'], id: string): RegisteredProvider => {
    if (!frozen) throw new TypeError('Behavior capability registry is not frozen.');
    const provider = providers.get(providerKey(kind, id));
    if (!provider) throw new TypeError(`Behavior ${kind} is not registered: ${id}`);
    return provider;
  };

  const assertAvailable = (provider: RegisteredProvider, allowed?: (capability: BehaviorCapability) => boolean) => {
    if (allowed && !allowed(provider.descriptor))
      throw new TypeError(`Behavior capability is unavailable for this actor: ${provider.descriptor.id}`);
  };

  const validateCondition = (
    condition: BehaviorCondition,
    depth: number,
    count: { value: number },
    allowed?: (capability: BehaviorCapability) => boolean,
  ): void => {
    if (!behaviorObject(condition) || depth > BEHAVIOR_MAX_DEPTH || ++count.value > BEHAVIOR_MAX_NODES)
      throw new TypeError('Behavior condition is invalid or too deep.');
    if ('name' in condition) {
      const provider = requireProvider('condition', String(condition.name));
      assertAvailable(provider, allowed);
      validateBehaviorArguments(provider.descriptor, condition.args);
      return;
    }
    const entries =
      'all' in condition
        ? condition.all
        : 'any' in condition
          ? condition.any
          : 'not' in condition
            ? [condition.not]
            : null;
    if (!entries || !Array.isArray(entries) || entries.length === 0)
      throw new TypeError('Behavior condition expression is invalid.');
    entries.forEach((entry) => validateCondition(entry, depth + 1, count, allowed));
  };

  const validateNode = (
    node: BehaviorNode,
    depth: number,
    count: { value: number },
    ids: Set<string>,
    allowed?: (capability: BehaviorCapability) => boolean,
  ): void => {
    if (!behaviorObject(node) || depth > BEHAVIOR_MAX_DEPTH || ++count.value > BEHAVIOR_MAX_NODES)
      throw new TypeError('Behavior tree is invalid or too large.');
    if (typeof node.id !== 'string' || !IDENTIFIER.test(node.id)) throw new TypeError('Behavior node id is invalid.');
    if (ids.has(node.id)) throw new TypeError('Behavior node ids must be unique.');
    ids.add(node.id);
    if ('guard' in node && node.guard) validateCondition(node.guard, depth + 1, count, allowed);
    if (node.type === 'selector' || node.type === 'sequence') {
      if (!Array.isArray(node.children) || !node.children.length)
        throw new TypeError('Behavior composite must have children.');
      node.children.forEach((child) => validateNode(child, depth + 1, count, ids, allowed));
    } else if (node.type === 'condition') validateCondition(node.condition, depth + 1, count, allowed);
    else if (node.type === 'action') {
      const provider = requireProvider('skill', String(node.skill));
      assertAvailable(provider, allowed);
      validateBehaviorArguments(provider.descriptor, node.args);
    } else throw new TypeError('Behavior node type is invalid.');
  };

  const validateDefinition = (
    definition: BehaviorDefinition,
    allowed?: (capability: BehaviorCapability) => boolean,
  ): void => {
    if (
      !behaviorObject(definition) ||
      definition.version !== BEHAVIOR_SCHEMA_VERSION ||
      behaviorJsonBytes(definition) > BEHAVIOR_MAX_BYTES
    )
      throw new TypeError('Behavior definition header is invalid or too large.');
    const ids = new Set<string>();
    const count = { value: 0 };
    validateNode(definition.root, 1, count, ids, allowed);
    for (const monitor of definition.monitors ?? []) {
      if (!IDENTIFIER.test(monitor.id) || ids.has(monitor.id) || !monitor.reason.trim() || monitor.reason.length > 256)
        throw new TypeError('Behavior monitor is invalid or duplicated.');
      ids.add(monitor.id);
      validateCondition(monitor.condition, 1, count, allowed);
    }
  };

  const registry: BehaviorCapabilityRegistry = Object.freeze({
    register(identity, definition) {
      if (frozen) throw new TypeError('Behavior capability registry is frozen.');
      if (providers.size >= BEHAVIOR_MAX_CAPABILITIES) throw new RangeError('Behavior capability limit exceeded.');
      if (
        !behaviorObject(identity) ||
        !NAMESPACE_ID.test(identity.moduleId) ||
        !EXACT_VERSION.test(identity.moduleVersion)
      )
        throw new TypeError('Behavior provider identity is invalid.');
      const legacy = identity.moduleId === STANDARD_BEHAVIOR_PROVIDER_MODULE_ID && !definition.id.includes(':');
      if ((!legacy && !NAMESPACE_ID.test(definition.id)) || !IDENTIFIER.test(definition.id))
        throw new TypeError(`Behavior capability id is invalid: ${definition.id || '<empty>'}`);
      if (!EXACT_VERSION.test(definition.version)) throw new TypeError('Behavior capability version is invalid.');
      if (!definition.description.trim() || definition.description.length > 512)
        throw new TypeError('Behavior capability description is invalid.');
      if (!behaviorObject(definition.arguments) || Object.keys(definition.arguments).length > 24)
        throw new TypeError('Behavior capability arguments are invalid.');
      for (const [name, rule] of Object.entries(definition.arguments)) {
        if (!IDENTIFIER.test(name)) throw new TypeError('Behavior argument name is invalid.');
        validateBehaviorArgumentRule(rule, `${definition.id}.${name}`);
      }
      if (definition.kind === 'condition' && typeof definition.evaluate !== 'function')
        throw new TypeError('Behavior condition evaluator is required.');
      if (definition.kind === 'skill') {
        validateBehaviorOperationRequirements(definition.requiredOperations, definition.id);
        if (
          typeof definition.start !== 'function' ||
          typeof definition.continue !== 'function' ||
          !EXACT_VERSION.test(definition.state.version) ||
          !Number.isSafeInteger(definition.state.maximumBytes) ||
          definition.state.maximumBytes < 2 ||
          definition.state.maximumBytes > BEHAVIOR_MAX_CAPABILITY_STATE_BYTES
        )
          throw new TypeError('Behavior skill state contract is invalid.');
      }
      const key = providerKey(definition.kind, definition.id);
      if (providers.has(key) || capabilityIds.has(definition.id))
        throw new TypeError(`Duplicate behavior capability: ${definition.id}`);
      const descriptor: BehaviorCapability = Object.freeze({
        id: definition.id,
        name: definition.id,
        kind: definition.kind,
        version: definition.version,
        provider: Object.freeze({ moduleId: identity.moduleId, version: identity.moduleVersion }),
        description: definition.description,
        arguments: frozenBehaviorValue(definition.arguments),
        requiredOperations:
          definition.kind === 'skill'
            ? snapshotBehaviorOperationRequirements(definition.requiredOperations)
            : Object.freeze([]),
        ...(definition.kind === 'skill'
          ? { state: Object.freeze({ version: definition.state.version, maximumBytes: definition.state.maximumBytes }) }
          : {}),
      });
      assertBehaviorCapabilityDescriptor(descriptor);
      providers.set(
        key,
        Object.freeze({
          identity: Object.freeze({ ...identity }),
          definition: snapshotBehaviorProvider(definition),
          descriptor,
        }),
      );
      capabilityIds.add(definition.id);
    },
    freeze(definitions) {
      if (frozen) throw new TypeError('Behavior capability registry is already frozen.');
      for (const provider of providers.values())
        assertBehaviorProviderAdmission(definitions, provider.identity, provider.descriptor);
      const candidate = Object.freeze(
        [...providers.values()]
          .map((entry) => frozenBehaviorValue(entry.descriptor))
          .sort((left, right) =>
            left.kind === right.kind ? left.id.localeCompare(right.id) : left.kind.localeCompare(right.kind),
          ),
      );
      if (!isBehaviorCapabilityCatalog(candidate)) throw new RangeError('Behavior capability catalog is invalid.');
      catalog = candidate;
      frozen = true;
    },
    catalog() {
      if (!frozen) throw new TypeError('Behavior capability registry is not frozen.');
      return catalog;
    },
    catalogForActor(binding, actorState, allowed) {
      if (!frozen) throw new TypeError('Behavior capability registry is not frozen.');
      if (
        !actorState ||
        actorState.lifecycle !== 'alive' ||
        actorState.controlSource !== 'behavior' ||
        actorState.reference.entityId !== binding.entityId ||
        actorState.reference.epoch !== binding.epoch ||
        actorState.reference.lifetime !== binding.lifetime
      )
        return Object.freeze([]);
      return Object.freeze(catalog.filter(allowed));
    },
    validateDefinition(definition) {
      validateDefinition(definition);
    },
    validateDefinitionForActor(definition, allowed) {
      if (typeof allowed !== 'function') throw new TypeError('Behavior actor capability gate is required.');
      validateDefinition(definition, allowed);
    },
    evaluate(id, context, args) {
      const provider = requireProvider('condition', id);
      if (provider.definition.kind !== 'condition') throw new TypeError(`Behavior condition is not registered: ${id}`);
      assertBehaviorProviderContext(context);
      assertAvailable(provider, context.allows);
      const readonlyContext: BehaviorConditionContext = Object.freeze({
        actor: context.actor,
        actorState: context.actorState,
        deltaSeconds: context.deltaSeconds,
        elapsedSeconds: context.elapsedSeconds,
        ...(provider.identity.moduleId === STANDARD_BEHAVIOR_PROVIDER_MODULE_ID
          ? { __standard: context.standard }
          : {}),
      });
      const result = provider.definition.evaluate(
        readonlyContext,
        validateBehaviorArguments(provider.descriptor, args),
      );
      if (typeof result !== 'boolean')
        throw new TypeError(`Behavior condition ${provider.descriptor.id} returned a non-boolean result.`);
      return result;
    },
    start(id, context, args) {
      const provider = requireProvider('skill', id);
      const definition = provider.definition;
      if (definition.kind !== 'skill') throw new TypeError(`Behavior skill is not registered: ${id}`);
      assertBehaviorProviderContext(context);
      assertAvailable(provider, context.allows);
      return normalizeBehaviorProviderResult(
        provider,
        withBehaviorProviderContext(provider, context, STANDARD_BEHAVIOR_PROVIDER_MODULE_ID, (providerContext) =>
          definition.start(providerContext, validateBehaviorArguments(provider.descriptor, args)),
        ),
      );
    },
    continue(id, context, args, state) {
      const provider = requireProvider('skill', id);
      const definition = provider.definition;
      if (definition.kind !== 'skill') throw new TypeError(`Behavior skill is not registered: ${id}`);
      assertBehaviorProviderContext(context);
      assertAvailable(provider, context.allows);
      validateBehaviorProviderState(provider, state);
      return normalizeBehaviorProviderResult(
        provider,
        withBehaviorProviderContext(provider, context, STANDARD_BEHAVIOR_PROVIDER_MODULE_ID, (providerContext) =>
          definition.continue(
            providerContext,
            validateBehaviorArguments(provider.descriptor, args),
            frozenBehaviorValue(state),
          ),
        ),
      );
    },
    cancel(id, context, args, state, reason) {
      const provider = requireProvider('skill', id);
      const definition = provider.definition;
      if (definition.kind !== 'skill') throw new TypeError(`Behavior skill is not registered: ${id}`);
      assertBehaviorProviderContext(context);
      assertAvailable(provider, context.allows);
      validateBehaviorProviderState(provider, state);
      if (!definition.cancel) return Object.freeze({ status: 'cancelled', phase: 'cancelled' });
      return normalizeBehaviorProviderResult(
        provider,
        withBehaviorProviderContext(provider, context, STANDARD_BEHAVIOR_PROVIDER_MODULE_ID, (providerContext) =>
          definition.cancel!(
            providerContext,
            validateBehaviorArguments(provider.descriptor, args),
            frozenBehaviorValue(state),
            reason,
          ),
        ),
      ) as Extract<BehaviorSkillProviderResult, { status: 'cancelled' | 'failed' }>;
    },
    checkpoint(id, state) {
      const provider = requireProvider('skill', id);
      validateBehaviorProviderState(provider, state);
      return Object.freeze({
        capabilityId: id,
        provider: frozenBehaviorValue(provider.descriptor.provider),
        state: Object.freeze({ version: provider.descriptor.state!.version, value: frozenBehaviorValue(state) }),
      });
    },
    assertRestorable(checkpoint) {
      if (!behaviorObject(checkpoint) || !behaviorObject(checkpoint.provider) || !behaviorObject(checkpoint.state))
        throw new TypeError('Behavior checkpoint is invalid.');
      const provider = requireProvider('skill', String(checkpoint.capabilityId));
      if (
        checkpoint.provider.moduleId !== provider.descriptor.provider.moduleId ||
        checkpoint.provider.version !== provider.descriptor.provider.version
      )
        throw new TypeError('Behavior checkpoint provider version is incompatible.');
      if (checkpoint.state.version !== provider.descriptor.state?.version)
        throw new TypeError('Behavior checkpoint state version is incompatible.');
      validateBehaviorProviderState(provider, checkpoint.state.value);
    },
  });
  return registry;
}

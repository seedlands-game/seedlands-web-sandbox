import type { ModModule, ModuleInvocationValue } from '../../composition/contracts';
import {
  TRANSPORT_INTERACTION_CAPABILITY,
  TRANSPORT_RESOURCE,
  type FrozenTransportInteractionConfig,
} from './transport-interaction-config';
import { commitTransportMotionCandidateV1, deriveMountedSeatConstraintV1 } from './transport-motion-state';
import type { TransportStateV2 } from './transport-model';
import type { TransportMotionCandidateV1 } from './transport-motion-model';

export const TRANSPORT_MOTION_CAPABILITY = 'seedlands:transport-motion';
export const TRANSPORT_MOTION_COMPONENT = 'seedlands:transport-motion-frame';
export type TransportMotionPolicy = Readonly<{
  definitionId: string;
  acceleration: number;
  drag: number;
  maxSpeed: number;
  steeringRate: number;
  fuelPerMeter: number;
}>;
export type TransportMotionConfig = Readonly<{
  moduleId: string;
  operationId: string;
  systemId: string;
  policies: readonly TransportMotionPolicy[];
}>;
export type TransportMotionProjection = Readonly<{
  version: 1;
  frameId: number;
  entries: readonly Readonly<{ state: TransportStateV2; candidate: TransportMotionCandidateV1 }>[];
}>;
export const transportMotionAddress = () => ({
  componentId: TRANSPORT_MOTION_COMPONENT,
  target: { kind: 'world' as const },
});

export function freezeTransportMotionConfig(input: TransportMotionConfig): TransportMotionConfig {
  const qualified = /^[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._/-]*$/;
  if (
    ![input.moduleId, input.operationId, input.systemId].every((id) => qualified.test(id)) ||
    !Array.isArray(input.policies) ||
    !input.policies.length ||
    input.policies.length > 256
  )
    throw new TypeError('Transport motion configuration is invalid.');
  const seen = new Set<string>();
  const limits = { acceleration: 100, drag: 100, maxSpeed: 32, steeringRate: 8, fuelPerMeter: 100 } as const;
  const policies = input.policies.map((policy) => {
    if (!qualified.test(policy.definitionId) || seen.has(policy.definitionId))
      throw new TypeError('Transport motion definition is invalid.');
    seen.add(policy.definitionId);
    for (const [key, maximum] of Object.entries(limits)) {
      const value = policy[key as keyof typeof limits];
      if (!Number.isFinite(value) || value < 0 || value > maximum)
        throw new RangeError('Transport motion policy exceeds its bound.');
    }
    return Object.freeze({
      definitionId: policy.definitionId,
      acceleration: policy.acceleration,
      drag: policy.drag,
      maxSpeed: policy.maxSpeed,
      steeringRate: policy.steeringRate,
      fuelPerMeter: policy.fuelPerMeter,
    });
  });
  return Object.freeze({
    moduleId: input.moduleId,
    operationId: input.operationId,
    systemId: input.systemId,
    policies: Object.freeze(policies),
  });
}

export function buildTransportMotionPublication(
  config: FrozenTransportInteractionConfig,
  projection: TransportMotionProjection,
) {
  if (
    projection.version !== 1 ||
    !Number.isSafeInteger(projection.frameId) ||
    projection.frameId < 1 ||
    !Array.isArray(projection.entries) ||
    projection.entries.length > 4096
  )
    throw new TypeError('Transport motion frame is invalid.');
  return {
    version: 1 as const,
    frameId: projection.frameId,
    entries: projection.entries.map(({ state, candidate }) => {
      const next = commitTransportMotionCandidateV1(state, candidate);
      return { state: next, seat: deriveMountedSeatConstraintV1(config.definitions.require(next.definitionId), next) };
    }),
  };
}

export function defineTransportMotionModule(input: TransportMotionConfig): ModModule {
  const config = freezeTransportMotionConfig(input);
  return Object.freeze({
    descriptor: {
      id: config.moduleId,
      version: '1.0.0',
      requires: [{ id: TRANSPORT_INTERACTION_CAPABILITY, version: '1.0.0' }],
      provides: [{ id: TRANSPORT_MOTION_CAPABILITY, version: '1.0.0', definitionIdentity: JSON.stringify(config) }],
      permissions: [{ resource: TRANSPORT_RESOURCE, operations: ['read', 'write', 'execute'] }],
    },
    register(api) {
      const transport = api.requireCapability<FrozenTransportInteractionConfig>(TRANSPORT_INTERACTION_CAPABILITY);
      for (const policy of config.policies) transport.definitions.require(policy.definitionId);
      api.provideCapability(TRANSPORT_MOTION_CAPABILITY, config);
      api.registerState({
        id: TRANSPORT_MOTION_COMPONENT,
        version: '1.0.0',
        resource: TRANSPORT_RESOURCE,
        validate: (value) => !!value && typeof value === 'object' && 'version' in value && value.version === 1,
      });
      api.registerOperation({
        id: config.operationId,
        resource: TRANSPORT_RESOURCE,
        executionKind: 'system',
        run(context, input, state) {
          if (context.kind !== 'system' || context.target.kind !== 'world' || input !== undefined)
            throw new TypeError('Transport motion requires its explicit physics system.');
          const address = transportMotionAddress();
          const result = buildTransportMotionPublication(transport, state.read(address) as TransportMotionProjection);
          state.write(address, result as ModuleInvocationValue);
          return result as ModuleInvocationValue;
        },
      });
      api.registerSystem({ id: config.systemId, operationId: config.operationId, cadence: 'manual' });
    },
  } satisfies ModModule);
}

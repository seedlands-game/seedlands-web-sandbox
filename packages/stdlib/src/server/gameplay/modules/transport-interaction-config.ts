import { defineRouteDefinitionV1, type RouteDefinitionV1 } from './route-definition';
import {
  createTransportDefinitionRegistryV1,
  type TransportDefinitionInputV1,
  type TransportDefinitionRegistryV1,
} from './transport-model';

export const TRANSPORT_INTERACTION_CAPABILITY = 'seedlands:transport-interactions';
export const TRANSPORT_DEPLOYMENT_COMPONENT = 'seedlands:transport-deployment';
export const TRANSPORT_RESOURCE = 'seedlands.transport';
export type TransportInteractionConfig = Readonly<{
  moduleId: string;
  operationId: string;
  definitions: readonly TransportDefinitionInputV1[];
  deployments: readonly Readonly<{ itemId: string; definitionId: string }>[];
  routes: readonly Readonly<{ definition: RouteDefinitionV1; voxels: readonly number[] }>[];
  surfaces: readonly Readonly<{ id: string; voxels: readonly number[]; surfaceOffset: number }>[];
}>;
export type FrozenTransportInteractionConfig = Omit<TransportInteractionConfig, 'definitions'> &
  Readonly<{ definitions: TransportDefinitionRegistryV1 }>;
const namespace = /^[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._/-]*$/;
const voxels = (values: readonly number[]) => {
  if (!Array.isArray(values) || !values.length || values.length > 256 || new Set(values).size !== values.length)
    throw new TypeError('Transport provider voxels are invalid.');
  const result = Array.from(values);
  if (!result.every((value) => Number.isSafeInteger(value) && value >= 0 && value <= 65535))
    throw new TypeError('Transport provider voxel is invalid.');
  return Object.freeze(result.sort((a, b) => a - b));
};

export function freezeTransportInteractionConfig(input: TransportInteractionConfig): FrozenTransportInteractionConfig {
  if (!namespace.test(input.moduleId) || !namespace.test(input.operationId))
    throw new TypeError('Transport module and operation IDs must be namespace-qualified.');
  const definitions = createTransportDefinitionRegistryV1(input.definitions);
  if (!Array.isArray(input.deployments) || input.deployments.length > 256)
    throw new TypeError('Transport deployment bindings are invalid.');
  const itemIds = new Set<string>();
  const deployments = Array.from(input.deployments, (binding) => {
    if (!binding || typeof binding.itemId !== 'string' || !binding.itemId.trim() || itemIds.has(binding.itemId))
      throw new TypeError('Transport deployment item is invalid or duplicated.');
    definitions.require(binding.definitionId);
    itemIds.add(binding.itemId);
    return Object.freeze({ itemId: binding.itemId, definitionId: binding.definitionId });
  });
  if (
    !Array.isArray(input.routes) ||
    !Array.isArray(input.surfaces) ||
    input.routes.length + input.surfaces.length > 256
  )
    throw new TypeError('Transport providers are invalid.');
  const providers = new Set<string>();
  const routes = Array.from(input.routes, (route) => {
    const definition = defineRouteDefinitionV1(route.definition);
    if (providers.has(definition.family)) throw new TypeError('Duplicate transport provider.');
    providers.add(definition.family);
    return Object.freeze({ definition, voxels: voxels(route.voxels) });
  });
  const surfaces = Array.from(input.surfaces, (surface) => {
    if (!namespace.test(surface.id) || providers.has(surface.id)) throw new TypeError('Invalid transport surface ID.');
    if (!Number.isFinite(surface.surfaceOffset) || surface.surfaceOffset < 0 || surface.surfaceOffset > 1)
      throw new TypeError('Transport surface offset must be between zero and one.');
    providers.add(surface.id);
    return Object.freeze({ id: surface.id, voxels: voxels(surface.voxels), surfaceOffset: surface.surfaceOffset });
  });
  for (const definition of definitions.list()) {
    const found =
      definition.locomotion.provider === 'route'
        ? routes.some((route) => route.definition.family === definition.locomotion.providerId)
        : surfaces.some((surface) => surface.id === definition.locomotion.providerId);
    if (!found) throw new TypeError('Transport definition requires its configured locomotion provider.');
    for (const axis of ['x', 'y', 'z'] as const)
      if (Math.abs(definition.bodyAabb.min[axis]) > 8 || Math.abs(definition.bodyAabb.max[axis]) > 8)
        throw new RangeError('Transport deployment body bounds exceed the bounded geometry budget.');
  }
  return Object.freeze({
    moduleId: input.moduleId,
    operationId: input.operationId,
    definitions,
    deployments: Object.freeze(deployments),
    routes: Object.freeze(routes),
    surfaces: Object.freeze(surfaces),
  });
}

export function transportDefinitionIdentity(config: FrozenTransportInteractionConfig): string {
  // Matches the existing checkpoint identity string budget; do not widen admission.
  const checkpointBudget = 4_096;
  const value = { ...config, definitions: config.definitions.list() };
  const original = JSON.stringify(value);
  if (original.length <= checkpointBudget) return original;
  const compact = JSON.stringify({
    ...value,
    format: 'seedlands:transport-definition-tuples:1',
    routes: value.routes.map(({ definition, voxels }) => ({
      voxels,
      definition: {
        version: definition.version,
        family: definition.family,
        variants: definition.variants.map(({ variant, edges }) => [
          variant,
          edges.map(({ entry, exit, curve, slopeDelta }) => [
            entry.side,
            entry.elevation,
            exit.side,
            exit.elevation,
            curve,
            slopeDelta,
          ]),
        ]),
        placementTieBreaks: definition.placementTieBreaks.map(({ variant, connected }) => [
          variant,
          connected.map(({ side, elevation }) => [side, elevation]),
        ]),
      },
    })),
  });
  if (compact.length > checkpointBudget)
    throw new RangeError('Transport definition identity exceeds checkpoint budget.');
  return compact;
}

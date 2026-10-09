import type { EntityLifetimeReference } from '../ecs-entity-owner';
import type { TransportRouteCursorV2 } from './transport-model';
import type { FrozenTransportInteractionConfig } from './transport-interaction-config';
import type { ItemInteractionTarget } from './item-interaction-module';

export type TransportDeploymentActorV1 = Readonly<{
  version: 1;
  reference: EntityLifetimeReference;
  position: readonly [number, number, number];
  alive: boolean;
  mode: 'creative' | 'survival';
  modeRevision: number;
  inventoryRevision: number;
  creativeCatalogRevision: number;
  selectedSlot: number;
  itemId: string | null;
  count: number;
}>;
export type TransportDeploymentOptionV1 = Readonly<{
  definitionId: string;
  position: readonly [number, number, number];
  yaw: number;
  routeCursor: TransportRouteCursorV2 | null;
  rejection: string | null;
}>;
export type TransportDeploymentSiteV1 = Readonly<{
  version: 1;
  hit: readonly [number, number, number];
  options: readonly TransportDeploymentOptionV1[];
}>;
export type TransportDeploymentCandidateV1 = Readonly<{
  version: 1;
  actorId: string;
  itemId: string;
  target: Extract<ItemInteractionTarget, { kind: 'voxel' }>;
  deployment: TransportDeploymentOptionV1;
}>;

export function buildTransportDeploymentCandidate(
  config: FrozenTransportInteractionConfig,
  actor: TransportDeploymentActorV1,
  site: TransportDeploymentSiteV1,
  input: unknown,
): TransportDeploymentCandidateV1 {
  if (!actor || actor.version !== 1 || !actor.alive || !actor.itemId || actor.count < 1)
    throw new Error('transport-selection-stale');
  const binding = config.deployments.find((entry) => entry.itemId === actor.itemId);
  if (!binding) throw new Error('transport-selected-item-unbound');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Transport input is invalid.');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).length !== 3 || value.version !== 1 || value.trigger !== 'voxel')
    throw new TypeError('Transport deployment requires its registered voxel interaction.');
  const target = value.target as Extract<ItemInteractionTarget, { kind: 'voxel' }>;
  if (
    !target ||
    target.kind !== 'voxel' ||
    Object.keys(target).length !== 3 ||
    !Array.isArray(target.hit) ||
    !Array.isArray(target.adjacent) ||
    target.hit.length !== 3 ||
    target.adjacent.length !== 3 ||
    !target.hit.every(Number.isSafeInteger) ||
    !target.adjacent.every(Number.isSafeInteger) ||
    target.hit.some((coordinate, axis) => coordinate !== site.hit[axis]) ||
    target.hit.reduce((sum, coordinate, axis) => sum + Math.abs(coordinate - target.adjacent[axis]), 0) !== 1
  )
    throw new TypeError('Transport deployment target is invalid.');
  const deployment = site.options.find((option) => option.definitionId === binding.definitionId);
  if (!deployment || deployment.rejection) throw new Error(deployment?.rejection ?? 'transport-target-invalid');
  return Object.freeze({
    version: 1,
    actorId: actor.reference.entityId,
    itemId: actor.itemId,
    target: Object.freeze({
      kind: 'voxel',
      hit: Object.freeze([...target.hit]) as typeof target.hit,
      adjacent: Object.freeze([...target.adjacent]) as typeof target.adjacent,
    }),
    deployment,
  });
}

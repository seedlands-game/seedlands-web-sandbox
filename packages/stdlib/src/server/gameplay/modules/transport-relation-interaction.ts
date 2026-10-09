import type { EntityLifetimeReference } from '../ecs-entity-owner';
import type { TransportDeploymentActorV1 } from './transport-deployment-model';
import type { TransportStateV2 } from './transport-model';
import type { ItemInteractionExpectedSelectionV1 } from './item-interaction-module';
import { isItemInteractionTarget, cloneItemInteractionExpectedSelection } from './item-interaction-module';
import { buildTransportMountCandidateV1, buildTransportDismountCandidateV1 } from './transport-relation-model';

export const TRANSPORT_RELATION_CAPABILITY = 'seedlands:transport-relations';
export const TRANSPORT_RELATION_COMPONENT = 'seedlands:transport-relation';
export const TRANSPORT_RELATION_SITE_COMPONENT = 'seedlands:transport-relation-site';
export type TransportRelationConfig = Readonly<{ moduleId: string; operationId: string }>;
export type TransportRelationActor = TransportDeploymentActorV1 & Readonly<{ mounted: EntityLifetimeReference | null }>;
export type TransportRelationSite = Readonly<{
  version: 1;
  state: TransportStateV2;
  seat: readonly [number, number, number];
  seatRejection: string | null;
  exits: readonly Readonly<{ position: readonly [number, number, number]; status: 'safe' | 'blocked' | 'unknown' }>[];
}>;
export type TransportRelationInput = Readonly<{
  version: 1;
  kind: 'mount' | 'dismount';
  target: EntityLifetimeReference | null;
  expectedSelection: ItemInteractionExpectedSelectionV1;
}>;
export const transportRelationAddress = (entityId: string) => ({
  componentId: TRANSPORT_RELATION_COMPONENT,
  target: { kind: 'entity' as const, entityId },
});
export const transportRelationSiteAddress = (entityId: string) => ({
  ...transportRelationAddress(entityId),
  componentId: TRANSPORT_RELATION_SITE_COMPONENT,
});

export function readTransportRelationInput(raw: unknown): TransportRelationInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new TypeError('Transport relation input is invalid.');
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).length !== 4 || value.version !== 1 || !['mount', 'dismount'].includes(value.kind as string))
    throw new TypeError('Transport relation fields are invalid.');
  if (value.target !== null && !isItemInteractionTarget({ kind: 'entity', reference: value.target }))
    throw new TypeError('Transport relation lifetime is invalid.');
  const target = value.target === null ? null : Object.freeze({ ...(value.target as EntityLifetimeReference) });
  if ((value.kind === 'mount') !== (target !== null)) throw new TypeError('Transport relation target is invalid.');
  return Object.freeze({
    version: 1,
    kind: value.kind as 'mount' | 'dismount',
    target,
    expectedSelection: cloneItemInteractionExpectedSelection(value.expectedSelection),
  });
}

export function buildTransportRelationInteraction(
  actor: TransportRelationActor,
  site: TransportRelationSite,
  raw: unknown,
) {
  const input = readTransportRelationInput(raw);
  if (!actor.alive) throw new Error('player-dead');
  for (const key of ['inventoryRevision', 'modeRevision', 'creativeCatalogRevision', 'selectedSlot'] as const)
    if (actor[key] !== input.expectedSelection[key]) throw new Error('stale-selection');
  const same = (left: EntityLifetimeReference | null, right: EntityLifetimeReference | null) =>
    JSON.stringify(left) === JSON.stringify(right);
  const checkpoint = { version: 2 as const, sequence: 0, transports: [site.state] };
  const isCurrent = (reference: EntityLifetimeReference) =>
    same(reference, actor.reference) || same(reference, site.state.reference);
  if (input.kind === 'mount') {
    if (!same(input.target, site.state.reference)) throw new Error('stale-transport');
    if (actor.mounted) throw new Error('actor-already-mounted');
    if (site.seatRejection) throw new Error(site.seatRejection);
    const result = buildTransportMountCandidateV1(checkpoint, {
      transport: site.state.reference,
      rider: actor.reference,
      isCurrent,
    });
    if (!result.success) throw new Error(result.reason);
    return Object.freeze({
      version: 1 as const,
      kind: input.kind,
      actor: actor.reference,
      transport: result.checkpoint.transports[0]!,
      position: site.seat,
    });
  }
  if (!same(actor.mounted, site.state.reference)) throw new Error('not-mounted');
  const result = buildTransportDismountCandidateV1(checkpoint, {
    rider: actor.reference,
    exits: site.exits,
    isCurrent,
  });
  if (!result.success) throw new Error(result.reason);
  return Object.freeze({
    version: 1 as const,
    kind: input.kind,
    actor: actor.reference,
    transport: result.checkpoint.transports[0]!,
    position: result.exitPosition,
  });
}

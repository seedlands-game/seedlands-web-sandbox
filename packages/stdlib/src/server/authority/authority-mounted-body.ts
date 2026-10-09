import type { AuthorityBodySnapshot, AuthorityEntity, AuthorityServerPort } from './authority-session-types';
import type { MountedSeatConstraintV1 } from '../gameplay/modules/transport-motion-model';
import { bodyStateForAuthorityEntity } from './creative-physics';

/** A transient projection, never another position or relation owner. */
export function currentMountedSeats(server: AuthorityServerPort) {
  const result = new Map<string, MountedSeatConstraintV1>();
  for (const constraint of server.mountedSeatConstraints?.() ?? []) {
    if (
      result.has(constraint.rider.entityId) ||
      (server.resolveEntityReference && !server.resolveEntityReference(constraint.rider))
    )
      throw new Error('Authority mounted rider reference is stale or duplicated.');
    result.set(constraint.rider.entityId, constraint);
  }
  return result;
}

export function mountedAuthorityBody(entity: AuthorityEntity, seat: MountedSeatConstraintV1): AuthorityBodySnapshot {
  const [x, y, z] = seat.pose.position;
  return {
    id: entity.id,
    type: entity.type,
    ...(entity.archetype ? { archetype: entity.archetype } : {}),
    body: { ...bodyStateForAuthorityEntity(entity), position: { x, y, z }, velocity: { x: 0, y: 0, z: 0 } },
    grounded: false,
    contacts: [],
  };
}

/** Transport velocity belongs to the registered motion policy, never passive character integration. */
export function heldAuthorityTransportBody(entity: AuthorityEntity): AuthorityBodySnapshot {
  return { id: entity.id, type: entity.type, body: bodyStateForAuthorityEntity(entity), grounded: false, contacts: [] };
}

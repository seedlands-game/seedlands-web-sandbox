import type { AuthorityPhysicsFrame } from './authority-physics-frame';
import type { AuthorityBodySnapshot, AuthorityEntity, AuthorityServerPort } from './authority-session-types';

export function commitAuthorityPhysicsEntities(
  server: AuthorityServerPort,
  entities: readonly AuthorityEntity[],
  nextBodies: ReadonlyMap<string, AuthorityBodySnapshot>,
  bodies: Map<string, AuthorityBodySnapshot>,
  frame?: Omit<AuthorityPhysicsFrame, 'updates'>,
): void {
  const updates = entities.map((entity) => {
    const body = nextBodies.get(entity.id)!;
    return {
      id: entity.id,
      update: {
        position: [body.body.position.x, body.body.position.y, body.body.position.z] as [number, number, number],
        physicsVelocity: [body.body.velocity.x, body.body.velocity.y, body.body.velocity.z] as [number, number, number],
      },
    };
  });
  const corrections = updates.length && frame ? server.commitPhysicsFrame?.({ ...frame, updates }) : null;
  if (!corrections && updates.length && server.updateEntities) server.updateEntities(updates);
  else if (!corrections) for (const { id, update } of updates) server.updateEntity(id, update);
  const corrected = new Map(corrections?.map((entry) => [entry.id, entry.update]));
  for (const entity of entities) {
    const next = nextBodies.get(entity.id)!;
    const correction = corrected.get(entity.id);
    if (!server.getEntity(entity.id)) {
      bodies.delete(entity.id);
      continue;
    }
    bodies.set(
      entity.id,
      correction
        ? {
            ...next,
            grounded: false,
            contacts: [],
            body: {
              ...next.body,
              position: { x: correction.position[0], y: correction.position[1], z: correction.position[2] },
              velocity: {
                x: correction.physicsVelocity[0],
                y: correction.physicsVelocity[1],
                z: correction.physicsVelocity[2],
              },
            },
          }
        : next,
    );
  }
}

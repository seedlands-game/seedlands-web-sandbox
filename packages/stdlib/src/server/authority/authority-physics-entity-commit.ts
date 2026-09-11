import type { AuthorityBodySnapshot, AuthorityEntity, AuthorityServerPort } from './authority-session-types';

export function commitAuthorityPhysicsEntities(
  server: AuthorityServerPort,
  entities: readonly AuthorityEntity[],
  nextBodies: ReadonlyMap<string, AuthorityBodySnapshot>,
  bodies: Map<string, AuthorityBodySnapshot>,
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
  if (updates.length && server.updateEntities) server.updateEntities(updates);
  else for (const { id, update } of updates) server.updateEntity(id, update);
  for (const entity of entities) bodies.set(entity.id, nextBodies.get(entity.id)!);
}

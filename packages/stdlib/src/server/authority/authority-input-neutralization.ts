import type { AuthorityServerPort } from './authority-session-types';

export function clearAuthorityHorizontalVelocity(
  server: Pick<AuthorityServerPort, 'getEntity' | 'updateEntity'>,
  playerId: string,
): boolean {
  const entity = server.getEntity(playerId);
  if (!entity || (!(entity.physicsVelocity?.[0] ?? 0) && !(entity.physicsVelocity?.[2] ?? 0))) return false;
  server.updateEntity(entity.id, {
    position: [...entity.position],
    physicsVelocity: [0, entity.physicsVelocity?.[1] ?? 0, 0],
  });
  return true;
}

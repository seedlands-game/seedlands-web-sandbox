import { separateBodies, probeBodyContacts, type BodyConfig, type BodyState } from '../../physics';
import type { PhysicsWorld } from '../../physics/types';
import type { AuthorityEntity, AuthorityBodySnapshot } from './authority-session-types';

export function separateAuthorityCharacters(
  entities: readonly AuthorityEntity[],
  bodies: Map<string, AuthorityBodySnapshot>,
  configs: ReadonlyMap<string, BodyConfig>,
  world: PhysicsWorld,
) {
  const characters = entities.filter(
    (entity) => entity.type === 'player' || entity.type === 'creature' || entity.type === 'npc',
  );
  const after = (snapshot: AuthorityBodySnapshot, body: BodyState, config: BodyConfig) => {
    if (snapshot.body === body) return snapshot;
    const probe = probeBodyContacts({ state: body, config, world });
    return { ...snapshot, body, grounded: probe.grounded, contacts: probe.contacts };
  };
  for (let leftIndex = 0; leftIndex < characters.length; leftIndex += 1)
    for (let rightIndex = leftIndex + 1; rightIndex < characters.length; rightIndex += 1) {
      const left = bodies.get(characters[leftIndex]!.id)!;
      const right = bodies.get(characters[rightIndex]!.id)!;
      const separation = separateBodies({
        left: left.body,
        leftConfig: configs.get(left.id)!,
        right: right.body,
        rightConfig: configs.get(right.id)!,
        world,
        maxDistance: 0.1,
      });
      bodies.set(left.id, after(left, separation.left, configs.get(left.id)!));
      bodies.set(right.id, after(right, separation.right, configs.get(right.id)!));
    }
}

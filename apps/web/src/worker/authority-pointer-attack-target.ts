import type { AuthorityRuntime } from '@seedlands/stdlib/server/authority/authority-runtime';
import type { AuthorityAction } from '@seedlands/stdlib/server/protocol/authority-worker-protocol';
import { PLAYER_FEET_OFFSET } from '../app/player/player-view-offsets';
import { nearestEntityHit } from '../client/presentation/entity-hit-volume';
import { traceVoxelTarget } from '../client/presentation/voxel-target';
import { PointerAttackInputPump } from './pointer-attack-input-pump';

/** Selects from current canonical actors/cells, then reuses the existing authorized attack transaction. */
export function createAuthorityPointerAttackPump(
  runtime: () => AuthorityRuntime | null,
  authorize: (action: AuthorityAction) => AuthorityAction,
) {
  return new PointerAttackInputPump({
    actor: () => {
      const current = runtime();
      if (!current) return null;
      const reference = current.server.createEntityReference(current.playerId);
      const player = current.view().player;
      return reference && player.lifecycle === 'alive' ? { reference, mode: player.mode?.value ?? 'survival' } : null;
    },
    attack: async (direction) => {
      const current = runtime();
      if (!current) return null;
      const reference = current.server.createEntityReference(current.playerId);
      const player = reference && current.server.resolveEntityReference(reference);
      if (!player) return null;
      const origin: [number, number, number] = [
        player.position[0],
        player.position[1] + PLAYER_FEET_OFFSET,
        player.position[2],
      ];
      const voxelTarget = traceVoxelTarget(
        origin,
        [...direction],
        (x, y, z) => current.server.peekLoadedVoxel(x, y, z)?.voxel ?? -1,
        (voxel) => voxel < 0 || (current.server.voxelSemantics.get(voxel)?.targetable ?? true),
      );
      const target = nearestEntityHit(
        current
          .view()
          .entities.filter(
            (entity) =>
              (entity.type === 'creature' || entity.type === 'npc') &&
              (entity.health === undefined || entity.health > 0),
          ),
        origin,
        direction,
        Math.min(3, voxelTarget?.distance ?? 3),
      );
      return target ? current.performAction(authorize({ type: 'attack', targetId: target.id })) : null;
    },
  });
}

import {
  assembleOverworldPacks,
  createGameplayActorAuthority,
  createGameplaySystemAuthority,
  type VerifiedPackArtifact,
} from '@seedlands/game-core/server/composition/host-api';
import { GameServer, type GameServerOptions } from '../../packages/game-core/src/server/game-server';
import type { ActorComponentSnapshot } from '../../packages/game-core/src/server/gameplay/ecs-actor-components';
import type { GameplaySnapshotV4 } from '../../packages/game-core/src/server/gameplay/gameplay-snapshot';
import { pack as overworld } from '../../packages/game-core/src/server/gameplay/playbooks/overworld/pack';

const artifact: VerifiedPackArtifact = {
  ...overworld,
  integrity: {
    algorithm: 'sha256',
    manifestDigest: 'a'.repeat(64),
    entryDigest: 'b'.repeat(64),
    resources: [],
  },
};

/** Explicitly enables the optional Overworld gameplay and Character behavior modules for tests. */
export const createCharacterComposition = () => assembleOverworldPacks([artifact]);

export const characterActorSnapshot = (
  gameplay: GameplaySnapshotV4,
  entityId?: string,
): ActorComponentSnapshot | undefined =>
  gameplay.entityStore.actors.find((actor) => actor.character && (!entityId || actor.entityId === entityId));

export function createCharacterServer(
  options: Omit<
    GameServerOptions,
    'composition' | 'moduleActorAuthority' | 'moduleSystemAuthority' | 'allowLegacyCompositionMigration'
  >,
): GameServer {
  const composition = createCharacterComposition();
  return new GameServer({
    ...options,
    composition,
    moduleActorAuthority: createGameplayActorAuthority(composition.resources, { playerAlias: 'test-player' }),
    moduleSystemAuthority: createGameplaySystemAuthority(composition),
    allowLegacyCompositionMigration: true,
  });
}

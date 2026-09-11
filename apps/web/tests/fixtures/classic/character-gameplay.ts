import {
  assembleOverworldPacks,
  createGameplayActorAuthority,
  createGameplaySystemAuthority,
  worldgenProviderForComposition,
  type VerifiedPackArtifact,
} from '@seedlands/stdlib/host';
import { GameServer, type GameServerOptions } from '../../../../../packages/stdlib/src/server/game-server';
import type { ActorComponentSnapshot } from '../../../../../packages/stdlib/src/server/gameplay/ecs-actor-components';
import type { GameplaySnapshotV4 } from '../../../../../packages/stdlib/src/server/gameplay/gameplay-snapshot';
import { pack as overworld } from '../../../../../playbooks/classic/src/pack';

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
  options: Omit<GameServerOptions, 'composition' | 'moduleActorAuthority' | 'moduleSystemAuthority'>,
): GameServer {
  const composition = createCharacterComposition();
  return new GameServer({
    ...options,
    composition,
    worldgenProvider: options.worldgenProvider ?? worldgenProviderForComposition(composition),
    moduleActorAuthority: createGameplayActorAuthority(composition.resources, { playerAlias: 'test-player' }),
    moduleSystemAuthority: createGameplaySystemAuthority(composition),
  });
}

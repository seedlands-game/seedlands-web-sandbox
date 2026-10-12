import type { WorldComposition } from './composition/contracts';
import type { EntityStore } from './gameplay/entity-store';
import type { GameplayContent } from './gameplay/gameplay-content';
import type { EntityLifetimeReference } from './gameplay/ecs-entity-owner';
import type { GameServerGameplayWorldPort } from './game-server-gameplay-world-port';
import { projectTransportStates, projectMountedSeatConstraints } from './gameplay/transport-projection';
import { projectTransportStorageViews } from './gameplay/transport-storage-access';

/** Every read resolves the active owner again, including after a gameplay restore. */
export class GameServerTransportQueries {
  readonly transportState;
  readonly transportProjections;
  readonly mountedSeatConstraints;
  readonly transportStorageProjections;
  constructor(
    owner: () => Readonly<{ entities: EntityStore; content: GameplayContent }>,
    options: Readonly<{ composition?: WorldComposition }>,
    world: Pick<GameServerGameplayWorldPort, 'readLoadedGameplayVoxel'>,
  ) {
    this.transportState = (reference: EntityLifetimeReference) => owner().entities.transportState(reference);
    this.transportProjections = () => projectTransportStates(owner().entities);
    this.mountedSeatConstraints = () => {
      const current = owner();
      return projectMountedSeatConstraints(current.entities, current.content.transportDefinitions);
    };
    this.transportStorageProjections = (actorId: string) => {
      const current = owner();
      return projectTransportStorageViews(current.entities, current.content, options.composition, actorId, (position) =>
        world.readLoadedGameplayVoxel(...position),
      );
    };
  }
}

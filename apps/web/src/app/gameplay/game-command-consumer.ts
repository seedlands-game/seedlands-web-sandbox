import type { CommandResult, ServerCommand } from '@seedlands/stdlib/server/commands/command-contract';
import type { BrowserAuthorityClient } from '../../client/authority/browser-authority-client';
import type { PlayerController } from '../player/player-controller';
import type { BrowserGameplay } from './browser-gameplay';
import type { WorldEnvironment } from '../scene/world-environment';
import type { World } from '../world/world-runtime';
import { PLAYER_FEET_OFFSET } from '../player/player-view-offsets';
import { consumeBrowserCommand } from '../game-runtime-controls';

export const createGameCommandConsumer =
  (
    options: Readonly<{
      queueSave(): void;
      playerId(): string | null;
      authority(): BrowserAuthorityClient | null;
      controller(): PlayerController | null;
      world(): World | null;
      environment(): WorldEnvironment | null;
      gameplay(): BrowserGameplay | null;
    }>,
  ) =>
  (command: ServerCommand, result: Extract<CommandResult, { success: true }>) =>
    consumeBrowserCommand(command, result, {
      queueSave: options.queueSave,
      playerId: options.playerId(),
      playerPosition: () => {
        const id = options.playerId();
        return id
          ? (options.authority()?.gameplay.entities.find((entity) => entity.id === id)?.position ?? null)
          : null;
      },
      movePlayer: ([x, y, z]) => void options.controller()?.movePlayerTo(x, y + PLAYER_FEET_OFFSET, z),
      setEnvironmentTime: () => {
        const world = options.world(),
          environment = options.environment();
        if (world && environment) environment.setTime(world.worldTime);
      },
      refreshGameplay: () => options.gameplay()?.refresh(),
    });

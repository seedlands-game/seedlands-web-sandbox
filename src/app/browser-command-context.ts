import {
  ALL_COMMAND_CAPABILITIES,
  ServerCommandExecutor,
  type CommandSource,
} from '../server/commands/server-command-executor';
import type { GameServer } from '../server/game-server';

export function browserCommandContext(server: GameServer, playerId: string) {
  const source: CommandSource = {
    actorId: 'browser-local-developer',
    sourceType: 'local-developer',
    entityId: playerId,
    capabilities: ALL_COMMAND_CAPABILITIES,
  };
  return { executor: new ServerCommandExecutor(server), source };
}

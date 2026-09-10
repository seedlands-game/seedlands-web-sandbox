import type { CommandResult, CommandSource } from '@seedlands/game-core/server/commands/command-contract';
import type { ModeCommand } from '@seedlands/game-core/server/commands/module-command';

export type BrowserModeCommandExecutor = (source: CommandSource, command: ModeCommand) => Promise<CommandResult>;

export async function executeBrowserModeCommand(
  execute: BrowserModeCommandExecutor,
  playerId: string,
  command: ModeCommand,
): Promise<Extract<CommandResult, { success: true }>> {
  const result = await execute(
    {
      actorId: 'browser-player',
      sourceType: 'browser-player',
      entityId: playerId,
      capabilities: ['mutation'],
    },
    command,
  );
  if (!result.success) throw new Error(result.error.message);
  return result;
}

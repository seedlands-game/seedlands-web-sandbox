import {
  executeSlashCommand,
  type CommandExecutorPort,
  type SlashCommandExecution,
} from '@seedlands/stdlib/server/commands/slash-command-parser';
import type { CommandResult, CommandSource, ServerCommand } from '@seedlands/stdlib/server/commands/command-contract';

export async function executeGameSlashCommand(
  executor: CommandExecutorPort | null,
  source: CommandSource | null,
  input: string,
  consume: (command: ServerCommand, result: Extract<CommandResult, { success: true }>) => void,
): Promise<SlashCommandExecution> {
  if (!executor || !source) throw new Error('服务端命令入口尚未就绪。');
  const execution = await executeSlashCommand(executor, source, input);
  if (execution.command && execution.result.success) consume(execution.command, execution.result);
  return execution;
}

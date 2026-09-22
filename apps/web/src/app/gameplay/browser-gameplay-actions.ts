import type { CommandResult, CommandSource } from '@seedlands/stdlib/server/commands/command-contract';
import type { ModeCommand } from '@seedlands/stdlib/server/commands/module-command';
import type { BrowserGameplayAuthorityPort } from './browser-gameplay';
import { BROWSER_MAX_BUILD_Y, BROWSER_MIN_BUILD_Y } from '../world/browser-world-limits';

export type BrowserModeCommandExecutor = (source: CommandSource, command: ModeCommand) => Promise<CommandResult>;

export function rejectOutOfBoundsBrowserBreak(
  position: [number, number, number],
  feedback: (message: string, tone: 'error') => void,
): boolean {
  if (position[1] <= BROWSER_MIN_BUILD_Y) {
    feedback('已到达浏览器世界底层；保留基底石层', 'error');
    return true;
  }
  if (position[1] > BROWSER_MAX_BUILD_Y) {
    feedback(`采集高度限 1–${BROWSER_MAX_BUILD_Y} 层`, 'error');
    return true;
  }
  return false;
}

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

export async function executeBrowserDifficulty(
  authority: BrowserGameplayAuthorityPort,
  value: import('@seedlands/stdlib/server/gameplay/difficulty-runtime').Difficulty,
  changed: () => void,
) {
  const current = authority.gameplay.difficulty;
  if (!current) throw new Error('难度状态尚未就绪。');
  const response = await authority.performAction({ type: 'set-difficulty', value, expectedRevision: current.revision });
  const result = response.result as { success: boolean; reason?: string };
  if (!result.success) throw new Error(result.reason ?? '难度更新失败。');
  changed();
}

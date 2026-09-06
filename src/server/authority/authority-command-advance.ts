import type { SessionAdvanceCommandResult } from '../commands/server-command-executor';
import type { WorldCommitResult } from '../game-server-types';
import type { AuthorityAdvanceResult } from './authority-runtime-types';

export function createAuthorityAdvanceCommandPort(
  advance: (elapsedMs: number) => AuthorityAdvanceResult,
  retainCommits: (commits: readonly WorldCommitResult[]) => void,
): (seconds: number) => SessionAdvanceCommandResult {
  return (seconds) => {
    const result = advance(seconds * 1_000);
    retainCommits(result.commits);
    return {
      physicsTick: result.snapshot.physicsTick,
      gameplayTime: result.gameplay.gameplayTime,
      worldTime: result.snapshot.worldTime,
      lanes: result.lanes,
      commits: result.commits,
    };
  };
}

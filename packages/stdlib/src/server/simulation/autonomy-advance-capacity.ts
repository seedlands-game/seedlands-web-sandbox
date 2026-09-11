import { STEP_SECONDS } from './actor-state';
import type { CombatRuntime } from '../gameplay/combat-runtime';
import type { CharacterRuntime } from './character-runtime';

export function autonomyAdvanceCommitUpperBound(
  seconds: number,
  stepAccumulator: number,
  characters: CharacterRuntime | null,
  registeredCombat: boolean,
  combat: CombatRuntime,
  registeredOperationCount = 0,
): number {
  if (!Number.isFinite(seconds) || seconds < 0) throw new TypeError('Actor rule seconds must be non-negative.');
  const stepCount = Math.floor((stepAccumulator + seconds + Number.EPSILON) / STEP_SECONDS);
  const characterCommits =
    characters?.advanceCommitUpperBound(stepCount, registeredOperationCount) ?? registeredOperationCount * 2;
  const combatFrontier = combat.peekPendingHits().length + combat.peekLifecycleEvents().length;
  return registeredCombat ? characterCommits : characterCommits + combatFrontier * 2;
}

import { computeFluidCandidate } from '../fluid/fluid-transaction';
import { decideLogicIntents } from '../logic/logic-decision';
import { runWorldComputeTask } from '../../worker/world-compute-task';
import {
  DedicatedComputeCancelledError,
  type DedicatedComputeResult,
  type DedicatedComputeTask,
} from './dedicated-compute-contract';

export type RunDedicatedComputeTaskOptions = Readonly<{
  isCancelled?: () => boolean;
  yieldTurn?: () => Promise<void>;
}>;

const assertActive = (isCancelled: () => boolean) => {
  if (isCancelled()) throw new DedicatedComputeCancelledError();
};

export async function runDedicatedComputeTask(
  task: DedicatedComputeTask,
  options: RunDedicatedComputeTaskOptions = {},
): Promise<DedicatedComputeResult> {
  const isCancelled = options.isCancelled ?? (() => false);
  assertActive(isCancelled);
  if (task.kind === 'generate-canonical' || task.kind === 'find-safe-spawn') {
    const result = await runWorldComputeTask(task, isCancelled, options.yieldTurn);
    if (result.kind !== 'canonical-result' && result.kind !== 'safe-spawn-result')
      throw new TypeError('Dedicated compute received a mesh result for a canonical task.');
    return result;
  }
  if (task.kind === 'fluid') {
    const candidate = computeFluidCandidate(task.snapshot);
    assertActive(isCancelled);
    return { kind: 'fluid-candidate', candidate };
  }
  const batch = decideLogicIntents(task.observation, { physicsHz: task.physicsHz });
  assertActive(isCancelled);
  return { kind: 'logic-intents', batch };
}

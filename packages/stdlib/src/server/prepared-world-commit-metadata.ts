import type { KernelStateOwner } from '@seedlands/kernel/execution';
import type { PreparedWorldCommitMetadata } from './world-edit-batch-plan';

export function prepareWorldCommitMetadata(
  owner: KernelStateOwner,
  worldRevision: number,
  mutationCount: number,
  mutations: Readonly<{ get(): number; set(value: number): void }>,
): PreparedWorldCommitMetadata {
  const epoch = owner.epoch;
  const previousWorldRevision = owner.worldRevision;
  const previousCommitSequence = owner.commitSequence;
  const previousMutationCount = mutations.get();
  if (worldRevision !== previousWorldRevision + 1) throw new Error('Prepared world revision is invalid.');
  if (!Number.isSafeInteger(mutationCount) || mutationCount < 0)
    throw new RangeError('Prepared mutation count is invalid.');
  let validated = false;
  return Object.freeze({
    validate() {
      validated = false;
      if (
        owner.epoch !== epoch ||
        owner.worldRevision !== previousWorldRevision ||
        owner.commitSequence !== previousCommitSequence ||
        mutations.get() !== previousMutationCount ||
        previousCommitSequence >= Number.MAX_SAFE_INTEGER ||
        previousMutationCount > Number.MAX_SAFE_INTEGER - mutationCount
      )
        throw new Error('Prepared world commit metadata is stale or exhausted.');
      validated = true;
    },
    apply() {
      if (!validated) throw new Error('Prepared world commit metadata requires validation.');
      owner.commitWorldRevision(epoch, worldRevision);
      mutations.set(previousMutationCount + mutationCount);
    },
  });
}

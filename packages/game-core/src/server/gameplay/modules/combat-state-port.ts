import type { ModuleInvocationValue } from '../../composition/contracts';
import type {
  ModStateAddress,
  ObservedModState,
  PreparedRegisteredCommit,
  RegisteredCommitContext,
  RegisteredStatePort,
} from '../../composition/operation-contracts';

/** Observations are bounded transaction receipts, not another persisted Combat state. */
export function createCombatStatePort(
  options: Readonly<{
    project(address: ModStateAddress): ModuleInvocationValue;
    frontierSignature(): string;
    prepare(observed: readonly ObservedModState[], execution: RegisteredCommitContext): PreparedRegisteredCommit;
  }>,
): RegisteredStatePort {
  let sequence = 0;
  const observations = new Map<number, Readonly<{ address: string; signature: string }>>();
  const signature = (address: ModStateAddress, value = options.project(address)) =>
    JSON.stringify([options.frontierSignature(), address, value]);
  const validate = (observed: readonly ObservedModState[]) => {
    const seen = new Set<string>();
    for (const entry of observed) {
      const key = JSON.stringify(entry.address);
      const receipt = observations.get(entry.revision);
      if (seen.has(key) || !receipt || receipt.address !== key || receipt.signature !== signature(entry.address))
        throw new Error('Combat projection observation is stale.');
      seen.add(key);
    }
  };
  return Object.freeze<RegisteredStatePort>({
    read(address) {
      const value = options.project(address);
      if (sequence >= Number.MAX_SAFE_INTEGER) throw new RangeError('Combat observation capacity is exhausted.');
      const revision = ++sequence;
      observations.set(revision, { address: JSON.stringify(address), signature: signature(address, value) });
      while (observations.size > 128) observations.delete(observations.keys().next().value!);
      return { revision, value };
    },
    commit: () => ({ ok: false, reason: 'Combat requires prepared host commit.' }),
    prepareCommit(observed, writes, execution) {
      if (writes.length)
        return {
          ok: false,
          code: 'COMBAT_STATE_WRITE_FORBIDDEN',
          reason: 'Combat transitions are candidates, not state writes.',
        };
      validate(observed);
      const plan = options.prepare(observed, execution);
      if (!plan.ok) return plan;
      return Object.freeze({
        ...plan,
        validate() {
          validate(observed);
          plan.validate();
        },
      });
    },
  });
}

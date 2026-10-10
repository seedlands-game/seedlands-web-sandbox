import type { AuthorityWorldOwner } from './authority-world-harness';
import type { WorldHarnessResult, WorldInspectResult } from './world-harness-contract';
import { describeWorldInspect, type CapturedWorldInspectRequest } from './world-harness-operations';
import { WorldOperationFailure } from './world-harness-state';
import type { ServerColumnSource } from '../server-column-source';

type Run = <Data>(
  describe: () => ReturnType<typeof describeWorldInspect>,
  execute: () => Promise<Data>,
) => Promise<WorldHarnessResult<Data>>;

/** Authorize and start under the host queue, await I/O outside it, then authorize publication. */
export async function inspectWorldColumnSource(
  captured: CapturedWorldInspectRequest,
  owner: () => AuthorityWorldOwner,
  run: Run,
): Promise<WorldHarnessResult<WorldInspectResult>> {
  let startedOwner: AuthorityWorldOwner | undefined;
  let pending: Promise<{ ok: true; source: ServerColumnSource } | { ok: false; cause: unknown }> | undefined;
  const started = await run(
    () => describeWorldInspect(captured),
    async () => {
      if (!captured.ok || captured.request.kind !== 'column-source') throw new TypeError('Column request is invalid.');
      startedOwner = owner();
      pending = startedOwner.runtime.server.inspectColumnSource(...captured.request.column).then(
        (source) => ({ ok: true as const, source }),
        (cause: unknown) => ({ ok: false as const, cause }),
      );
      return null;
    },
  );
  if (!started.ok) return started;
  const observation = await pending!;
  return run(
    () => describeWorldInspect(captured),
    async () => {
      const current = owner();
      if (
        current.epoch !== startedOwner!.epoch ||
        current.worldId !== startedOwner!.worldId ||
        current.runtime !== startedOwner!.runtime
      )
        throw new WorldOperationFailure(
          'WORLD_EPOCH_STALE',
          'Column observation belongs to a replaced world.',
          'conflict',
        );
      if (!observation.ok) throw observation.cause;
      const source = observation.source;
      return {
        kind: 'column-source' as const,
        source:
          source.status === 'complete' && source.worldRevision !== current.runtime.server.worldRevision
            ? { status: 'unknown' as const, reason: 'superseded' as const }
            : source,
      };
    },
  );
}

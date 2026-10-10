import type { AuthorityRuntime } from '@seedlands/stdlib/server/authority/authority-runtime';
import type { AuthorityWorldHarness } from '@seedlands/stdlib/server/harness/authority-world-harness';
import type { WorldInspectResult } from '@seedlands/stdlib/server/harness/world-harness-contract';

type Source = Extract<WorldInspectResult, { kind: 'column-source' }>['source'];
type Owner = Readonly<{ server: AuthorityRuntime['server']; epoch: string; worldId: string }>;

/** Same renderer/Authority owner as canonical reads. Persistent I/O never owns the host queue. */
export async function observeAuthorityColumnSource(
  harness: Pick<AuthorityWorldHarness, 'hostOperation'>,
  owner: () => Owner,
  cx: number,
  cz: number,
  requestedEpoch: string | undefined,
): Promise<Source> {
  if (![cx, cz].every(Number.isSafeInteger)) throw new TypeError('Column coordinates are invalid.');
  const submitted = owner();
  const sameOwner = () => {
    const current = owner();
    return (
      current.epoch === requestedEpoch &&
      current.epoch === submitted.epoch &&
      current.worldId === submitted.worldId &&
      current.server === submitted.server
    );
  };
  let pending!: Promise<{ ok: true; source: Source } | { ok: false; cause: unknown }>;
  await harness.hostOperation(() => {
    if (!sameOwner()) throw new Error('WORLD_EPOCH_STALE: Column request belongs to a stale runtime.');
    pending = submitted.server.inspectColumnSource(cx, cz).then(
      (source) => ({ ok: true as const, source }),
      (cause: unknown) => ({ ok: false as const, cause }),
    );
  });
  const observation = await pending;
  return harness.hostOperation(() => {
    if (!sameOwner()) return { status: 'unknown' as const, reason: 'superseded' as const };
    if (!observation.ok) throw observation.cause;
    const source = observation.source;
    return source.status === 'complete' && source.worldRevision !== owner().server.worldRevision
      ? { status: 'unknown' as const, reason: 'superseded' as const }
      : source;
  });
}

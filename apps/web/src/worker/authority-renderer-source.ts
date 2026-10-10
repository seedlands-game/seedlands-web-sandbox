import { CHUNK_SIZE, chunkKey } from '@seedlands/stdlib/world/voxel';
import { PROTOCOL_VERSION } from '@seedlands/stdlib/runtime/session-protocol';
import type { AuthorityRuntime } from '@seedlands/stdlib/server/authority/authority-runtime';
import type { AuthorityWorldHarness } from '@seedlands/stdlib/server/harness/authority-world-harness';
import type { AuthorityCollisionBaselineResult } from '@seedlands/stdlib/server/game-server-types';
import type { AuthorityRequest, AuthorityResponse } from '@seedlands/stdlib/server/protocol/authority-worker-protocol';
import type { BrowserChunkPersistence } from '../client/persistence/browser-chunk-persistence';
import { observeAuthorityColumnSource } from './authority-column-source';

type Owner = Readonly<{
  runtime: AuthorityRuntime;
  persistence: Pick<
    BrowserChunkPersistence,
    'worldId' | 'seedText' | 'generatorVersion' | 'readStoredSkySnapshot' | 'sourceReadFence'
  >;
  epoch: string;
}>;
type Harness = Pick<AuthorityWorldHarness, 'hostOperation'>;
type Request = Extract<AuthorityRequest, { kind: 'request-column-source' | 'request-sky-source' }> & {
  runtimeEpoch?: string;
};

/** Durable I/O stays outside the Authority writer frontier; no canonical resident is created. */
export async function observeAuthoritySkySource(
  harness: Harness,
  owner: () => Owner,
  key: string,
  revision: number,
  requestedEpoch: string | undefined,
): Promise<AuthorityCollisionBaselineResult> {
  const coordinates = key.split(',').map(Number);
  if (
    coordinates.length !== 3 ||
    !coordinates.every(Number.isSafeInteger) ||
    key !== chunkKey(coordinates[0]!, coordinates[1]!, coordinates[2]!) ||
    !Number.isSafeInteger(revision) ||
    revision < 0
  )
    throw new TypeError('Sky source coordinates or revision are invalid.');
  const [cx, cy, cz] = coordinates as [number, number, number];
  const submitted = owner(),
    worldId = submitted.persistence.worldId;
  const persistenceFence = submitted.persistence.sourceReadFence();
  const sameOwner = () => {
    const current = owner();
    return (
      current.epoch === requestedEpoch &&
      current.epoch === submitted.epoch &&
      current.runtime === submitted.runtime &&
      current.persistence === submitted.persistence &&
      current.persistence.worldId === worldId &&
      persistenceFence !== null &&
      current.persistence.sourceReadFence() === persistenceFence
    );
  };
  const unavailable = (): AuthorityCollisionBaselineResult => ({ status: 'unavailable', key });
  let worldRevision = -1;
  let pending!: Promise<{ ok: true; value: AuthorityCollisionBaselineResult } | { ok: false; cause: unknown }>;
  await harness.hostOperation(() => {
    if (!sameOwner()) throw new Error('WORLD_EPOCH_STALE: Sky source request belongs to a stale runtime.');
    worldRevision = submitted.runtime.server.worldRevision;
    const resident = submitted.runtime.readCollisionBaseline(key, 0);
    if (resident.status === 'available') {
      pending = Promise.resolve({ ok: true, value: resident.chunkRevision === revision ? resident : unavailable() });
      return;
    }
    pending = submitted.persistence
      .readStoredSkySnapshot(cx, cy, cz, revision)
      .then((snapshot): AuthorityCollisionBaselineResult => {
        if (
          !snapshot ||
          snapshot.key !== key ||
          snapshot.cx !== cx ||
          snapshot.cy !== cy ||
          snapshot.cz !== cz ||
          snapshot.revision !== revision ||
          snapshot.seedText !== submitted.persistence.seedText ||
          snapshot.generatorVersion !== submitted.persistence.generatorVersion ||
          !(snapshot.voxels instanceof Uint16Array) ||
          snapshot.voxels.length !== CHUNK_SIZE ** 3 ||
          ((snapshot.fluid !== undefined || snapshot.fluidVersion !== undefined) &&
            (snapshot.fluidVersion !== 1 ||
              !(snapshot.fluid instanceof Uint8Array) ||
              snapshot.fluid.length !== CHUNK_SIZE ** 3))
        )
          return unavailable();
        return {
          status: 'available',
          key,
          chunkRevision: revision,
          canonical: snapshot.voxels.slice().buffer,
          fluid: snapshot.fluid?.slice().buffer ?? new ArrayBuffer(CHUNK_SIZE ** 3),
        };
      })
      .then(
        (value) => ({ ok: true as const, value }),
        (cause: unknown) => ({ ok: false as const, cause }),
      );
  });
  const result = await pending;
  return harness.hostOperation(() => {
    if (!sameOwner() || submitted.runtime.server.worldRevision !== worldRevision) return unavailable();
    if (!result.ok) throw result.cause;
    return result.value;
  });
}

export async function handleAuthorityRendererSource(
  message: Request,
  harness: Harness,
  owner: () => Owner,
  sessionEpoch: string,
  post: (response: AuthorityResponse, transfer?: Transferable[]) => void,
): Promise<void> {
  const result =
    message.kind === 'request-column-source'
      ? await observeAuthorityColumnSource(
          harness,
          () => {
            const current = owner();
            return { server: current.runtime.server, epoch: current.epoch, worldId: current.persistence.worldId };
          },
          message.cx,
          message.cz,
          message.runtimeEpoch,
        )
      : await observeAuthoritySkySource(harness, owner, message.key, message.minimumRevision, message.runtimeEpoch);
  post(
    {
      kind: 'authority-response',
      protocolVersion: PROTOCOL_VERSION,
      epoch: sessionEpoch,
      runtimeEpoch: message.runtimeEpoch,
      requestId: message.requestId,
      ok: true,
      result,
    },
    result.status === 'available' ? [result.canonical, result.fluid] : [],
  );
}

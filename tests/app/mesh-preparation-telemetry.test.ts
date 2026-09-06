import { describe, expect, it } from 'vitest';
import { MeshTaskScheduler, type MeshWorkerPort } from '../../src/app/mesh-task-scheduler';
import { PERFORMANCE_PROFILES } from '../../src/client/performance-profile';
import { PerformanceTelemetry } from '../../src/client/performance-telemetry';

class CapturingWorker implements MeshWorkerPort {
  onmessage: MeshWorkerPort['onmessage'] = null;
  onerror: MeshWorkerPort['onerror'] = null;
  readonly posts: Array<Record<string, unknown>> = [];

  postMessage(message: Record<string, unknown>) {
    this.posts.push(message);
  }

  terminate() {}
}

describe('Mesh preparation telemetry', () => {
  it('把一次Authority与持久化请求分项写入同一Worker-first trace', () => {
    const worker = new CapturingWorker();
    const telemetry = new PerformanceTelemetry({ now: () => 25 });
    const scheduler = new MeshTaskScheduler({
      worker,
      profile: PERFORMANCE_PROFILES.benchmark,
      telemetry,
      variant: 'worker-first',
      source: {
        seed: 7,
        generatorVersion: 3,
        prepareMainSnapshot: () => ({
          chunkRevision: 0,
          haloRevision: 'unused',
          canonical: new Uint16Array(1),
          halo: new Uint16Array(1),
        }),
        prepareWorkerInput: () => ({
          chunkRevision: 1,
          generatorVersion: 3,
          overlays: [],
          preparationDiagnostics: {
            authorityPrepareMs: 19,
            persistenceWaitMs: 14,
            snapshotCopyMs: 1,
            persistence: {
              requestedKeyCount: 27,
              foundCount: 4,
              missingCount: 23,
              queueWaitMs: 2,
              databaseMs: 1,
              transactionReadMs: 4,
              decodeMs: 3,
              totalWorkerMs: 10,
              sharedDependencyCount: 18,
              mailboxWaitMs: 6,
              mailboxBlockerKind: 'save-frozen',
              mailboxBlockerOverlapMs: 5,
              mailboxBlockerEncodeMs: 4,
              replyDeliveryMs: 7,
              roundTripMs: 25,
              codecs: { 'raw-v1': 4 },
            },
          },
        }),
        acceptWorkerCanonical: () => true,
      },
      onAcceptedResult: () => undefined,
    });

    scheduler.request(0, 1, -2);
    const traceId = worker.posts[0]!.traceId;
    const events = telemetry.exportChromeTrace().traceEvents.filter(({ args }) => args?.traceId === traceId);
    expect(events.map(({ name, dur }) => [name, dur])).toEqual(
      expect.arrayContaining([
        ['AuthorityPrepare', 19_000],
        ['AuthorityPersistenceWait', 14_000],
        ['AuthoritySnapshotCopy', 1_000],
        ['PersistenceTaskQueue', 2_000],
        ['PersistenceDatabase', 1_000],
        ['PersistenceTransactionRead', 4_000],
        ['PersistenceBatchDecode', 3_000],
        ['PersistenceWorkerLoad', 10_000],
        ['PersistenceMailboxWait', 6_000],
        ['PersistenceReplyDelivery', 7_000],
        ['PersistenceRoundTrip', 25_000],
      ]),
    );
    expect(events.find(({ name }) => name === 'PersistenceWorkerLoad')?.args).toMatchObject({
      traceId,
      requestedKeyCount: 27,
      foundCount: 4,
      missingCount: 23,
      codecs: 'raw-v1:4',
    });
    expect(events.find(({ name }) => name === 'AuthorityPersistenceWait')?.args).toMatchObject({
      traceId,
      sharedDependencyCount: 18,
    });
    expect(events.find(({ name }) => name === 'PersistenceMailboxWait')?.args).toMatchObject({
      traceId,
      blockerKind: 'save-frozen',
      blockerOverlapMs: 5,
      blockerEncodeMs: 4,
    });
  });
});

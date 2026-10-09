import { describe, expect, it, vi } from 'vitest';
import { World } from '../../../src/app/world/world-runtime';
import { MeshTaskScheduler, type MeshWorkerPort, type WorkerResult } from '../../../src/app/world/mesh-task-scheduler';
import { PERFORMANCE_PROFILES } from '../../../src/client/presentation/performance-profile';
import { PerformanceTelemetry } from '../../../src/client/presentation/performance-telemetry';
import { FluidFeedbackTracker } from '../../../src/app/gameplay/fluid-feedback-tracker';
import { testWorldgenProvider } from '../client/fixtures/worldgen-provider';
import type { WorldCommitResult } from '@seedlands/stdlib/server/game-server-types';
import { BrowserAuthorityClient } from '../../../src/client/authority/browser-authority-client';
import { FakeAuthorityWorker } from '../client/fixtures/browser-authority';

class PreparationWorker implements MeshWorkerPort {
  onmessage: ((event: MessageEvent<WorkerResult>) => void) | null = null;
  readonly posts: Array<Record<string, unknown>> = [];
  postMessage(message: Record<string, unknown>) {
    this.posts.push(message);
  }
  terminate() {}
  complete(post: Record<string, unknown>) {
    this.onmessage?.(
      new MessageEvent<WorkerResult>('message', {
        data: {
          kind: 'mesh-result',
          taskId: post.taskId as number,
          traceId: post.traceId as string,
          epoch: post.epoch as number,
          chunkKey: post.chunkKey as string,
          chunkRevision: post.chunkRevision as number,
          haloRevision: post.haloRevision as string,
          cx: post.cx as number,
          cy: post.cy as number,
          cz: post.cz as number,
          generatorVersion: post.generatorVersion as number,
          canonical: post.canonical instanceof ArrayBuffer ? post.canonical.slice(0) : new Uint16Array(1).buffer,
          workerMeshingMs: 1,
          meshes: [],
        },
      }),
    );
  }
}

function fixture(holdSecondPreparation = false) {
  const worker = new PreparationWorker();
  let revision = 1;
  let preparedRevision: number | undefined;
  let releaseFirst!: () => void;
  const firstPreparation = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let releaseSecond!: () => void;
  const secondPreparation = new Promise<void>((resolve) => {
    releaseSecond = resolve;
  });
  const events: string[] = [];
  const beforePrepare = vi.fn(async () => {
    const captured = revision;
    events.push(`prepare-${captured}`);
    if (beforePrepare.mock.calls.length === 1) await firstPreparation;
    if (holdSecondPreparation && beforePrepare.mock.calls.length === 2) await secondPreparation;
    preparedRevision = captured;
  });
  const accepted = vi.fn();
  const scheduler = new MeshTaskScheduler({
    worker,
    profile: PERFORMANCE_PROFILES.benchmark,
    telemetry: new PerformanceTelemetry({ now: () => 1 }),
    variant: 'worker-first',
    source: {
      seed: 7,
      generatorVersion: 3,
      provider: testWorldgenProvider,
      beforePrepare,
      releasePrepared: () => {
        events.push('release');
        preparedRevision = undefined;
      },
      prepareMainSnapshot: () => {
        throw new Error('worker-first only');
      },
      prepareWorkerInput: () => {
        if (preparedRevision === undefined) throw new Error('unprepared');
        return { chunkRevision: preparedRevision, generatorVersion: 3, overlays: [] };
      },
      acceptWorkerCanonical: (task) => task.chunkRevision === revision,
    },
    onAcceptedResult: accepted,
  });
  const receiver = {
    aggregateStructuralEventCount: 0,
    latestCommitMutationCount: 0,
    latestCommitMeshChunkCount: 0,
    aggregateRemeshSchedulingCount: 0,
    dirtyChunks: new Set<string>(),
    fluidDirtyChunks: new Set<string>(),
    fluidFeedback: new FluidFeedbackTracker(() => 1),
    blockLightCache: { invalidateAround: vi.fn() },
    scheduler,
    repository: { chunks: new Map() },
    scheduleRemesh: vi.fn(),
  };
  const commit = (actorId: string, nextRevision = 2) => {
    revision = nextRevision;
    World.prototype.consumeServerCommit.call(
      receiver as unknown as World,
      {
        structuralChange: {
          type: 'voxel-region-changed',
          actorId,
          worldRevision: revision,
          mutationCount: 1,
          chunks: ['0,0,0'],
          chunkRevisions: [{ key: '0,0,0', revision }],
          meshChunks: ['0,0,0'],
        },
      } as WorldCommitResult,
    );
  };
  return { worker, scheduler, receiver, beforePrepare, accepted, commit, releaseFirst, releaseSecond, events };
}

describe('World commit during actual worker-first mesh preparation', () => {
  it.each(['player-edit', 'fluid-v2'])(
    '%s replaces and refreshes a preparation before first presentation',
    async (actorId) => {
      const subject = fixture();
      try {
        subject.scheduler.request(0, 0, 0);
        await vi.waitFor(() => expect(subject.beforePrepare).toHaveBeenCalledTimes(1));
        expect(subject.scheduler.requestedKeys.has('0,0,0')).toBe(true);
        expect(subject.scheduler.latestTask('0,0,0')).toBeUndefined();
        subject.commit(actorId);
        subject.releaseFirst();
        await vi.waitFor(() => expect(subject.worker.posts).toHaveLength(1));
        expect(subject.worker.posts[0]).toMatchObject({
          chunkRevision: 2,
          priority: actorId === 'fluid-v2' ? 'interactive-fluid' : 'interactive',
        });
        expect(subject.events.slice(0, 3)).toEqual(['prepare-1', 'release', 'prepare-2']);
        subject.worker.complete(subject.worker.posts[0]!);
        await vi.waitFor(() => expect(subject.accepted).toHaveBeenCalledTimes(1));
        expect(subject.accepted.mock.calls[0]![0]).toMatchObject({
          chunkRevision: 2,
          ...(actorId === 'fluid-v2' ? { visibilityBarrierRevision: 2 } : {}),
        });
        expect(subject.receiver.aggregateRemeshSchedulingCount).toBe(1);
      } finally {
        subject.scheduler.dispose();
      }
    },
  );

  it('does not admit an unrequested and unpresented offscreen chunk', () => {
    const subject = fixture();
    try {
      subject.commit('player-edit');
      expect(subject.scheduler.requestedKeys.size).toBe(0);
      expect(subject.beforePrepare).not.toHaveBeenCalled();
      expect(subject.receiver.aggregateRemeshSchedulingCount).toBe(0);
    } finally {
      subject.scheduler.dispose();
    }
  });

  it.each(['player-edit', 'fluid-v2'])(
    '%s bounds refresh under continuous commits and rejects the superseded worker result',
    async (actorId) => {
      const subject = fixture(true);
      try {
        subject.scheduler.request(0, 0, 0);
        subject.commit(actorId, 2);
        subject.releaseFirst();
        await vi.waitFor(() => expect(subject.beforePrepare).toHaveBeenCalledTimes(2));
        for (let revision = 3; revision <= 121; revision++) subject.commit(actorId, revision);
        subject.releaseSecond();
        await vi.waitFor(() => expect(subject.worker.posts).toHaveLength(1));
        expect(subject.beforePrepare).toHaveBeenCalledTimes(2);
        const priority = actorId === 'fluid-v2' ? 'interactive-fluid' : 'interactive';
        expect(subject.worker.posts[0]).toMatchObject({ chunkRevision: 2, priority });
        subject.worker.complete(subject.worker.posts[0]!);
        await vi.waitFor(() => expect(subject.worker.posts).toHaveLength(2));
        expect(subject.accepted).not.toHaveBeenCalled();
        expect(subject.worker.posts[1]).toMatchObject({ chunkRevision: 121, priority });
        expect(subject.worker.posts[1]!.traceId).not.toBe(subject.worker.posts[0]!.traceId);
        subject.worker.complete(subject.worker.posts[1]!);
        await vi.waitFor(() => expect(subject.accepted).toHaveBeenCalledTimes(1));
        expect(subject.accepted.mock.calls[0]![0]).toMatchObject({ chunkRevision: 121 });
      } finally {
        subject.scheduler.dispose();
      }
    },
  );

  it('reprepares a rejected real BrowserAuthorityClient lease after commit delivery', async () => {
    const authorityWorker = new FakeAuthorityWorker();
    const subject = fixture();
    // Replace the synthetic preparation source with the actual client producer while
    // keeping authority/mesh Worker replies explicit. This is an async adapter test.
    const client = new BrowserAuthorityClient(authorityWorker, 'world:1', {
      onCommit: (commit) => World.prototype.consumeServerCommit.call(subject.receiver as unknown as World, commit),
    });
    const accepted = vi.fn();
    const scheduler = new MeshTaskScheduler({
      worker: subject.worker,
      profile: PERFORMANCE_PROFILES.benchmark,
      telemetry: new PerformanceTelemetry({ now: () => 1 }),
      variant: 'worker-first',
      source: {
        seed: 7,
        generatorVersion: 3,
        provider: testWorldgenProvider,
        beforePrepare: (cx, cy, cz) => client.ensureChunkNeighborhood(cx, cy, cz),
        releasePrepared: (cx, cy, cz) => client.releasePreparation(cx, cy, cz),
        prepareWorkerInput: (cx, cy, cz) => client.prepareWorkerInput(cx, cy, cz),
        prepareMainSnapshot: () => {
          throw new Error('worker-first only');
        },
        acceptWorkerCanonical: (task, result) => client.acceptWorkerCanonical(task, result),
      },
      onAcceptedResult: accepted,
    });
    subject.receiver.scheduler = scheduler;
    const prepareReplies = (requestId: number, revision: number) => {
      const canonical = new Uint16Array(32 ** 3);
      if (revision === 2) canonical[0] = 3;
      authorityWorker.emit({
        kind: 'mesh-prepared',
        protocolVersion: 1,
        epoch: 'world:1',
        requestId,
        payload: {
          key: '0,0,0',
          cx: 0,
          cy: 0,
          cz: 0,
          chunkRevision: revision,
          generatorVersion: 3,
          provider: testWorldgenProvider,
          canonical: canonical.buffer,
          overlays: [],
        },
      });
    };
    try {
      scheduler.request(0, 0, 0);
      const first = authorityWorker.posts[0] as { requestId: number };
      const editing = client.editWorld('player-1', [{ x: 0, y: 0, z: 0, value: 3 }]);
      const edit = authorityWorker.posts.at(-1) as { requestId: number };
      const commit = {
        committed: true,
        worldRevision: 2,
        structuralChange: {
          type: 'voxel-region-changed',
          actorId: 'player-edit',
          worldRevision: 2,
          mutationCount: 1,
          chunks: ['0,0,0'],
          chunkRevisions: [{ key: '0,0,0', revision: 2 }],
          meshChunks: ['0,0,0'],
        },
      } as WorldCommitResult;
      authorityWorker.emit({
        kind: 'authority-response',
        protocolVersion: 1,
        epoch: 'world:1',
        requestId: edit.requestId,
        ok: true,
        result: commit,
        commits: [commit],
      });
      await editing;
      prepareReplies(first.requestId, 1);
      await vi.waitFor(() =>
        expect(authorityWorker.posts.filter((post) => (post as { kind: string }).kind === 'prepare-mesh')).toHaveLength(
          2,
        ),
      );
      expect(subject.worker.posts).toHaveLength(0);
      const second = authorityWorker.posts.at(-1) as { requestId: number };
      prepareReplies(second.requestId, 2);
      await vi.waitFor(() => expect(subject.worker.posts).toHaveLength(1));
      expect(subject.worker.posts[0]).toMatchObject({ chunkRevision: 2, priority: 'interactive' });
      subject.worker.complete(subject.worker.posts[0]!);
      const acceptance = authorityWorker.posts.at(-1) as { kind: string; requestId: number };
      expect(acceptance.kind).toBe('accept-generated-chunk');
      authorityWorker.emit({
        kind: 'authority-response',
        protocolVersion: 1,
        epoch: 'world:1',
        requestId: acceptance.requestId,
        ok: true,
        result: { accepted: true },
      });
      await vi.waitFor(() => expect(accepted).toHaveBeenCalledTimes(1));
      expect(accepted.mock.calls[0]![0]).toMatchObject({ chunkRevision: 2 });
      expect(client.getChunkRevision(0, 0, 0)).toBe(2);
      expect(client.getVoxel(0, 0, 0)).toBe(3);
    } finally {
      scheduler.dispose();
      subject.scheduler.dispose();
      client.dispose();
    }
  });
});

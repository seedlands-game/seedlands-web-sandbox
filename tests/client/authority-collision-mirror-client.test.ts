import { describe, expect, it, vi } from 'vitest';
import { BrowserAuthorityClient, type AuthorityWorkerPort } from '../../src/client/browser-authority-client';
import type { AuthoritySnapshot } from '../../src/server/authority/authority-session';
import type { WorldCommitResult } from '../../src/server/game-server-types';
import type { AuthorityResponse } from '../../src/worker/authority-worker-protocol';
import { CHUNK_SIZE, Voxel, voxelIndex } from '../../src/world/voxel';

class FakeAuthorityWorker implements AuthorityWorkerPort {
  onmessage: ((event: MessageEvent<AuthorityResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly posts: unknown[] = [];

  postMessage(message: unknown): void {
    this.posts.push(message);
  }

  terminate(): void {}

  emit(message: AuthorityResponse): void {
    this.onmessage?.({ data: message } as MessageEvent<AuthorityResponse>);
  }
}

const snapshot = (physicsTick: number, commitSequence: number): AuthoritySnapshot => ({
  kind: 'snapshot',
  protocolVersion: 1,
  epoch: 'world:1',
  physicsTick,
  commitSequence,
  worldMutationCount: commitSequence,
  acknowledgedInputSequence: -1,
  inputResyncRequired: false,
  activeTimeMs: physicsTick * (1000 / 60),
  integratedPhysicsTimeMs: physicsTick * (1000 / 60),
  physicsDebtMs: 0,
  player: {
    id: 'player-1',
    type: 'player',
    body: { position: { x: 0.5, y: 33, z: 0.5 }, velocity: { x: 0, y: 0, z: 0 } },
    grounded: true,
    contacts: [],
  },
  entities: [],
  chunkRevisions: { '0,0,0': 5 },
  worldRevision: commitSequence,
  worldTime: 9,
  paused: false,
});

const commit = (previousRevision: number, revision: number, voxel: number, fluid: number) =>
  ({
    committed: true,
    worldRevision: revision,
    structuralChange: {
      type: 'voxel-region-changed',
      actorId: 'browser-test',
      worldRevision: revision,
      mutationCount: 1,
      chunks: ['0,0,0'],
      chunkRevisions: [{ key: '0,0,0', revision }],
      meshChunks: ['0,0,0'],
      bounds: { min: [1, 2, 3], max: [1, 2, 3] },
    },
    collisionDelta: [
      {
        key: '0,0,0',
        previousRevision,
        revision,
        cells: [{ index: voxelIndex(1, 2, 3), voxel, fluid }],
      },
    ],
    semanticEvents: [],
    metrics: {
      timingStatus: 'measured',
      inputMutationCount: 1,
      canonicalWriteCount: 1,
      dirtyChunkCount: 1,
      meshInvalidationCount: 1,
      structuralEventCount: 1,
      semanticEventCount: 0,
      mutationPayloadBytes: 14,
      mutationCapacityBytes: 14,
      validationMs: 0,
      resolveMs: 0,
      applyMs: 0,
      commitMs: 0,
    },
  }) as WorldCommitResult;

async function installBaseline(client: BrowserAuthorityClient, worker: FakeAuthorityWorker): Promise<void> {
  const canonical = new Uint16Array(CHUNK_SIZE ** 3);
  const fluid = new Uint8Array(CHUNK_SIZE ** 3);
  const preparing = client.ensureChunkNeighborhood(0, 0, 0);
  const prepareRequest = worker.posts.at(-1) as { requestId: number };
  worker.emit({
    kind: 'mesh-prepared',
    protocolVersion: 1,
    epoch: 'world:1',
    requestId: prepareRequest.requestId,
    payload: {
      key: '0,0,0',
      cx: 0,
      cy: 0,
      cz: 0,
      chunkRevision: 4,
      generatorVersion: 3,
      canonical: canonical.buffer,
      fluid: fluid.buffer,
      overlays: [],
    },
  });
  await preparing;
  const accepting = client.acceptWorkerCanonical(
    { chunkKey: '0,0,0', cx: 0, cy: 0, cz: 0, chunkRevision: 4, generatorVersion: 3 },
    { canonical: canonical.buffer, generatorVersion: 3 },
  );
  const acceptRequest = worker.posts.at(-1) as { requestId: number };
  worker.emit({
    kind: 'authority-response',
    protocolVersion: 1,
    epoch: 'world:1',
    requestId: acceptRequest.requestId,
    ok: true,
    result: { accepted: true },
  });
  await accepting;
}

describe('生产BrowserAuthorityClient碰撞镜像接线', () => {
  it('在gameplay回执完成前应用放置增量，并在流体快照中应用最终流体状态', async () => {
    const worker = new FakeAuthorityWorker();
    const client = new BrowserAuthorityClient(worker, 'world:1');
    await installBaseline(client, worker);
    const placed = commit(4, 5, Voxel.Stone, 0);
    const action = client.performAction({ type: 'place', position: [1, 2, 3] });
    const actionRequest = worker.posts.at(-1) as { requestId: number };
    worker.emit({
      kind: 'authority-response',
      protocolVersion: 1,
      epoch: 'world:1',
      requestId: actionRequest.requestId,
      ok: true,
      result: { result: { success: true }, commits: [placed] },
      commits: [placed],
    });
    expect(client.getVoxel(1, 2, 3)).toBe(Voxel.Stone);
    expect(client.getChunkRevision(0, 0, 0)).toBe(5);
    await action;

    const flowed = commit(5, 6, Voxel.Water, 0x88);
    worker.emit({
      kind: 'authority-snapshot',
      protocolVersion: 1,
      epoch: 'world:1',
      snapshot: { ...snapshot(1, 1), chunkRevisions: { '0,0,0': 6 } },
      commits: [flowed],
    });
    expect(client.getVoxel(1, 2, 3)).toBe(Voxel.Water);
    expect(client.getFluidCell(1, 2, 3)).toEqual({ level: 8, source: true });
    expect(client.getChunkRevision(0, 0, 0)).toBe(6);

    const staleCanonical = new Uint16Array(CHUNK_SIZE ** 3);
    staleCanonical[voxelIndex(1, 2, 3)] = Voxel.Dirt;
    const staleAcceptance = client.acceptWorkerCanonical(
      { chunkKey: '0,0,0', cx: 0, cy: 0, cz: 0, chunkRevision: 4, generatorVersion: 3 },
      { canonical: staleCanonical.buffer, generatorVersion: 3 },
    );
    const staleRequest = worker.posts.at(-1) as { requestId: number };
    worker.emit({
      kind: 'authority-response',
      protocolVersion: 1,
      epoch: 'world:1',
      requestId: staleRequest.requestId,
      ok: true,
      result: { accepted: true },
    });
    await expect(staleAcceptance).resolves.toBe(true);
    expect(client.getVoxel(1, 2, 3)).toBe(Voxel.Water);
    expect(client.getChunkRevision(0, 0, 0)).toBe(6);
  });

  it('缺口失效后拒绝此前已发出但延迟成功的旧网格回执', async () => {
    const worker = new FakeAuthorityWorker();
    const unknown = vi.fn();
    const client = new BrowserAuthorityClient(worker, 'world:1', { onUnknownChunk: unknown });
    await installBaseline(client, worker);
    const staleCanonical = new Uint16Array(CHUNK_SIZE ** 3);
    staleCanonical[0] = Voxel.Dirt;
    const acceptingStale = client.acceptWorkerCanonical(
      { chunkKey: '0,0,0', cx: 0, cy: 0, cz: 0, chunkRevision: 5, generatorVersion: 3 },
      { canonical: staleCanonical.buffer, generatorVersion: 3 },
    );
    const staleRequest = worker.posts.at(-1) as { requestId: number };

    const skipped = commit(5, 6, Voxel.Stone, 0);
    worker.emit({
      kind: 'authority-snapshot',
      protocolVersion: 1,
      epoch: 'world:1',
      snapshot: { ...snapshot(2, 2), chunkRevisions: { '0,0,0': 6 } },
      commits: [skipped],
    });
    expect(client.getChunkRevision(0, 0, 0)).toBeNull();
    expect(unknown).toHaveBeenCalledWith('0,0,0');

    worker.emit({
      kind: 'authority-response',
      protocolVersion: 1,
      epoch: 'world:1',
      requestId: staleRequest.requestId,
      ok: true,
      result: { accepted: true },
    });
    await acceptingStale;
    expect(client.getChunkRevision(0, 0, 0)).toBeNull();
    expect(client.getVoxel(0, 0, 0)).toBe(Voxel.Air);
  });

  it('卸载后不让在途旧网格回执复活碰撞镜像，重新请求的新代际仍可安装', async () => {
    const worker = new FakeAuthorityWorker();
    const client = new BrowserAuthorityClient(worker, 'world:1');
    await installBaseline(client, worker);
    const staleCanonical = new Uint16Array(CHUNK_SIZE ** 3);
    staleCanonical[0] = Voxel.Dirt;
    const acceptingStale = client.acceptWorkerCanonical(
      { chunkKey: '0,0,0', cx: 0, cy: 0, cz: 0, chunkRevision: 5, generatorVersion: 3 },
      { canonical: staleCanonical.buffer, generatorVersion: 3 },
    );
    const staleRequest = worker.posts.at(-1) as { requestId: number };

    client.releaseChunkNeighborhood(0, 0, 0);
    worker.emit({
      kind: 'authority-response',
      protocolVersion: 1,
      epoch: 'world:1',
      requestId: staleRequest.requestId,
      ok: true,
      result: { accepted: true },
    });
    await expect(acceptingStale).resolves.toBe(true);
    expect(client.getChunkRevision(0, 0, 0)).toBeNull();
    expect(client.getVoxel(0, 0, 0)).toBe(Voxel.Air);

    const freshCanonical = new Uint16Array(CHUNK_SIZE ** 3);
    freshCanonical[0] = Voxel.Stone;
    const acceptingFresh = client.acceptWorkerCanonical(
      { chunkKey: '0,0,0', cx: 0, cy: 0, cz: 0, chunkRevision: 6, generatorVersion: 3 },
      { canonical: freshCanonical.buffer, generatorVersion: 3 },
    );
    const freshRequest = worker.posts.at(-1) as { requestId: number };
    worker.emit({
      kind: 'authority-response',
      protocolVersion: 1,
      epoch: 'world:1',
      requestId: freshRequest.requestId,
      ok: true,
      result: { accepted: true },
    });
    await expect(acceptingFresh).resolves.toBe(true);
    expect(client.getChunkRevision(0, 0, 0)).toBe(6);
    expect(client.getVoxel(0, 0, 0)).toBe(Voxel.Stone);
  });

  it('旧运动快照迟到时仍消费其唯一提交，并让重复投递保持一次性', async () => {
    const worker = new FakeAuthorityWorker();
    const onCommit = vi.fn();
    const client = new BrowserAuthorityClient(worker, 'world:1', { onCommit });
    await installBaseline(client, worker);
    const changed = commit(4, 5, Voxel.Stone, 0);

    worker.emit({
      kind: 'authority-snapshot',
      protocolVersion: 1,
      epoch: 'world:1',
      snapshot: { ...snapshot(2, 6), chunkRevisions: { '0,0,0': 5 } },
    });
    const delayed = {
      kind: 'authority-snapshot',
      protocolVersion: 1,
      epoch: 'world:1',
      snapshot: { ...snapshot(1, 5), chunkRevisions: { '0,0,0': 5 } },
      commits: [changed],
    } as const;
    worker.emit(delayed);
    worker.emit(delayed);

    expect(client.getVoxel(1, 2, 3)).toBe(Voxel.Stone);
    expect(client.getChunkRevision(0, 0, 0)).toBe(5);
    expect(client.snapshot?.physicsTick).toBe(2);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });
});

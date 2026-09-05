/// <reference lib="webworker" />

import { BrowserChunkPersistence, type SerializedChunkSnapshot } from '../client/browser-chunk-persistence';
import { AuthorityRuntime, type AuthorityInitialWorldBootstrap } from '../server/authority/authority-runtime';
import { PROTOCOL_VERSION } from '../runtime/session-protocol';
import type { AuthorityRequest, AuthorityResponse } from './authority-worker-protocol';

const scope = self as DedicatedWorkerGlobalScope;
let runtime: AuthorityRuntime | null = null;
let persistence: BrowserChunkPersistence | null = null;
let interval: ReturnType<typeof setInterval> | null = null;
let epoch = '';
let lastSnapshotPublishedAt = Number.NEGATIVE_INFINITY;
let lastGameplayPublishedAt = Number.NEGATIVE_INFINITY;
let bootstrapRequestSequence = 0;
let pendingBootstrap: {
  requestId: number;
  resolve: (bootstrap: AuthorityInitialWorldBootstrap) => void;
  reject: (error: Error) => void;
} | null = null;

const post = (message: AuthorityResponse, transfer: Transferable[] = []) => scope.postMessage(message, transfer);

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

const assertCurrent = (message: AuthorityRequest) => {
  if (!runtime || message.epoch !== epoch) throw new Error('Authority session is unavailable or stale.');
  return runtime;
};

const respond = (requestId: number, result: unknown, options: { gameplay?: boolean; commits?: boolean } = {}) => {
  const current = runtime!;
  post({
    kind: 'authority-response',
    protocolVersion: PROTOCOL_VERSION,
    epoch,
    requestId,
    ok: true,
    result,
    ...(options.gameplay ? { gameplay: current.view() } : {}),
    ...(options.commits ? { commits: current.takeCommits() } : {}),
  });
};

type TransactionResponse = Readonly<{
  result: unknown;
  gameplay?: ReturnType<AuthorityRuntime['view']>;
  commits?: ReturnType<AuthorityRuntime['takeCommits']>;
}>;

const transact = async (
  message: Extract<
    AuthorityRequest,
    {
      kind:
        | 'world-edit'
        | 'set-player-position'
        | 'gameplay-action'
        | 'server-command'
        | 'set-world-time'
        | 'set-world-clock-rate'
        | 'pause-authority'
        | 'resume-authority';
    }
  >,
  operation: () => TransactionResponse | Promise<TransactionResponse>,
) => {
  const current = runtime!;
  const receipt = await current.executeTransaction({ epoch, ...message.transaction }, operation);
  if (receipt.status !== 'executed') {
    fail(message.requestId ?? -1, new Error(`Authority transaction ${receipt.status} at ${receipt.commitSequence}.`));
    return;
  }
  if (message.requestId === undefined) return;
  post({
    kind: 'authority-response',
    protocolVersion: PROTOCOL_VERSION,
    epoch,
    requestId: message.requestId,
    ok: true,
    result: receipt.result.result,
    commitSequence: receipt.commitSequence,
    ...(receipt.result.gameplay ? { gameplay: receipt.result.gameplay } : {}),
    ...(receipt.result.commits?.length ? { commits: receipt.result.commits } : {}),
  });
};

const fail = (requestId: number, error: unknown) =>
  post({
    kind: 'authority-response',
    protocolVersion: PROTOCOL_VERSION,
    epoch,
    requestId,
    ok: false,
    error: errorText(error),
  });

const tick = () => {
  if (!runtime) return;
  const now = performance.now();
  const snapshot = runtime.wake(now);
  if (now - lastSnapshotPublishedAt < 1000 / 60) return;
  const publishGameplay = now - lastGameplayPublishedAt >= 50;
  const commits = runtime.takeCommits();
  post({
    kind: 'authority-snapshot',
    protocolVersion: PROTOCOL_VERSION,
    epoch,
    snapshot,
    ...(publishGameplay ? { gameplay: runtime.view() } : {}),
    ...(commits.length ? { commits } : {}),
  });
  lastSnapshotPublishedAt = now;
  if (publishGameplay) lastGameplayPublishedAt = now;
};

const requestBootstrap = (seed: number, generatorVersion: number) => {
  if (pendingBootstrap) return Promise.reject(new Error('Authority bootstrap generation is already pending.'));
  const requestId = ++bootstrapRequestSequence;
  const promise = new Promise<AuthorityInitialWorldBootstrap>((resolve, reject) => {
    pendingBootstrap = { requestId, resolve, reject };
  });
  post({
    kind: 'authority-bootstrap-needed',
    protocolVersion: PROTOCOL_VERSION,
    epoch,
    requestId,
    seed,
    generatorVersion,
  });
  return promise;
};

const start = async (message: Extract<AuthorityRequest, { kind: 'start-authority' }>) => {
  if (runtime || persistence) throw new Error('Authority Worker already owns a running session.');
  epoch = message.epoch;
  persistence = await BrowserChunkPersistence.open(message.seedText, {
    legacySnapshots: message.legacySnapshots as readonly SerializedChunkSnapshot[],
    openMode: message.openMode,
  });
  runtime = await AuthorityRuntime.create({
    epoch,
    seedText: message.seedText,
    generatorVersion: persistence.generatorVersion,
    persistence,
    initialWorldTime: message.initialWorldTime,
    frequencies: message.frequencies,
    startTimeMs: 0,
    now: () => performance.now(),
    findInitialWorldBootstrap: requestBootstrap,
    onFluidWork: (snapshot) => post({ kind: 'fluid-work', protocolVersion: PROTOCOL_VERSION, epoch, snapshot }),
    onLogicObservation: (observation) =>
      post(
        {
          kind: 'logic-observation',
          protocolVersion: PROTOCOL_VERSION,
          epoch,
          observation,
        },
        observation.decisionContext.terrainWindows.map((window) => window.occupancy.buffer),
      ),
    onUnknownChunk: (key) => post({ kind: 'authority-chunk-needed', protocolVersion: PROTOCOL_VERSION, epoch, key }),
  });
  post({ kind: 'authority-ready', protocolVersion: PROTOCOL_VERSION, epoch, ready: runtime.ready() });
  interval = setInterval(tick, 8);
};

const handle = async (message: AuthorityRequest) => {
  if (!message || message.protocolVersion !== PROTOCOL_VERSION) return;
  if (message.kind === 'start-authority') return start(message);
  if (message.kind === 'authority-bootstrap-result') {
    if (message.epoch !== epoch || !pendingBootstrap || message.requestId !== pendingBootstrap.requestId) return;
    const pending = pendingBootstrap;
    pendingBootstrap = null;
    if (
      message.playerBodyPosition.length !== 3 ||
      !message.playerBodyPosition.every((value) => Number.isFinite(value)) ||
      !Array.isArray(message.starterChunks)
    )
      pending.reject(new Error('Safe spawn compute result is invalid.'));
    else
      pending.resolve({
        playerBodyPosition: message.playerBodyPosition,
        starterChunks: message.starterChunks.map((chunk) => ({
          ...chunk,
          canonical: new Uint16Array(chunk.canonical),
        })),
      });
    return;
  }
  const current = assertCurrent(message);
  switch (message.kind) {
    case 'input':
      post({
        kind: 'input-decision',
        protocolVersion: PROTOCOL_VERSION,
        epoch,
        sequence: message.sequence,
        decision: current.receiveInput(message),
        requiresResync: current.inputResyncRequired,
      });
      break;
    case 'pause-authority':
      await transact(message, () => {
        const now = performance.now();
        current.pause(now);
        return { result: { paused: true, snapshot: current.wake(now) } };
      });
      break;
    case 'resume-authority':
      await transact(message, () => {
        const now = performance.now();
        current.resume(now);
        return { result: { paused: false, snapshot: current.wake(now) } };
      });
      break;
    case 'prepare-mesh': {
      const payload = await current.prepareMesh(message.cx, message.cy, message.cz);
      const transfers = [
        ...(payload.canonical ? [payload.canonical] : []),
        ...(payload.fluid ? [payload.fluid] : []),
        ...payload.overlays.flatMap((overlay) => [overlay.voxels, ...(overlay.fluid ? [overlay.fluid] : [])]),
      ];
      post(
        {
          kind: 'mesh-prepared',
          protocolVersion: PROTOCOL_VERSION,
          epoch,
          requestId: message.requestId,
          payload,
        },
        transfers,
      );
      break;
    }
    case 'request-collision-baseline': {
      const result = current.readCollisionBaseline(message.key, message.minimumRevision);
      if (result.status === 'unavailable') respond(message.requestId, result);
      else
        post(
          {
            kind: 'authority-response',
            protocolVersion: PROTOCOL_VERSION,
            epoch,
            requestId: message.requestId,
            ok: true,
            result,
          },
          [result.canonical, result.fluid],
        );
      break;
    }
    case 'accept-generated-chunk':
      respond(message.requestId, {
        accepted: current.acceptGeneratedChunk({
          key: message.key,
          cx: message.cx,
          cy: message.cy,
          cz: message.cz,
          chunkRevision: message.chunkRevision,
          generatorVersion: message.generatorVersion,
          canonical: new Uint16Array(message.canonical),
        }),
      });
      break;
    case 'release-mesh':
      current.releaseMesh(message.cx, message.cy, message.cz);
      break;
    case 'set-fluid-active-chunks':
      current.setFluidActiveChunks(message.keys);
      break;
    case 'world-edit':
      await transact(message, async () => ({
        result: await current.editWorld(message.actorId, message.edits),
        gameplay: current.view(),
        commits: current.takeCommits(),
      }));
      break;
    case 'set-player-position':
      await transact(message, () => {
        current.setPlayerPosition(message.position);
        return { result: { moved: true, snapshot: current.wake(performance.now()) }, gameplay: current.view() };
      });
      break;
    case 'gameplay-action': {
      await transact(message, async () => {
        const result = await current.performAction(message.action);
        return { result, gameplay: result.gameplay, commits: [...result.commits] };
      });
      break;
    }
    case 'server-command': {
      await transact(message, async () => ({
        result: await current.executeCommand(message.source, message.command),
        gameplay: current.view(),
        commits: current.takeCommits(),
      }));
      break;
    }
    case 'set-world-time': {
      await transact(message, () => ({ result: { worldTime: current.setWorldTime(message.hours) } }));
      break;
    }
    case 'set-world-clock-rate':
      await transact(message, () => ({ result: { rate: current.setWorldClockRate(message.rate) } }));
      break;
    case 'save-authority':
      respond(message.requestId, await current.save(), { gameplay: true });
      break;
    case 'fluid-candidate':
      current.commitFluidCandidate(message.candidate);
      break;
    case 'fluid-failure':
      current.abortFluidWork(message.workId, message.reason);
      break;
    case 'logic-intents':
      current.receiveLogicIntentBatch(message.batch);
      break;
    case 'request-logic-observation':
      current.requestLogicObservation();
      break;
    case 'dispose-authority':
      if (interval !== null) clearInterval(interval);
      interval = null;
      persistence?.dispose();
      persistence = null;
      pendingBootstrap?.reject(new Error('Authority Worker was disposed during bootstrap.'));
      pendingBootstrap = null;
      runtime = null;
      scope.close();
      break;
  }
};

scope.onmessage = (event: MessageEvent<AuthorityRequest>) => {
  const requestId = 'requestId' in event.data ? event.data.requestId : undefined;
  void handle(event.data).catch((error) => {
    if (typeof requestId === 'number') fail(requestId, error);
    else
      post({
        kind: 'authority-fatal',
        protocolVersion: PROTOCOL_VERSION,
        epoch: event.data.epoch,
        error: errorText(error),
      });
  });
};

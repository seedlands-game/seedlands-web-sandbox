/// <reference lib="webworker" />

import { BrowserChunkPersistence, type SerializedChunkSnapshot } from '../client/browser-chunk-persistence';
import { AuthorityRuntime } from '../server/authority/authority-runtime';
import { ServerCommandExecutor } from '../server/commands/server-command-executor';
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
  resolve: (position: [number, number, number]) => void;
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
  const promise = new Promise<[number, number, number]>((resolve, reject) => {
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
    startTimeMs: 0,
    now: () => performance.now(),
    findInitialPlayerBodyPosition: requestBootstrap,
    onFluidWork: (snapshot) => post({ kind: 'fluid-work', protocolVersion: PROTOCOL_VERSION, epoch, snapshot }),
    onLogicObservation: (observationSequence, snapshot) =>
      post({
        kind: 'logic-observation',
        protocolVersion: PROTOCOL_VERSION,
        epoch,
        observationSequence,
        snapshot,
      }),
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
    if (message.playerBodyPosition.length !== 3 || !message.playerBodyPosition.every((value) => Number.isFinite(value)))
      pending.reject(new Error('Safe spawn compute result is invalid.'));
    else pending.resolve(message.playerBodyPosition);
    return;
  }
  const current = assertCurrent(message);
  switch (message.kind) {
    case 'input':
      current.receiveInput(message);
      break;
    case 'pause-authority':
      current.pause(performance.now());
      break;
    case 'resume-authority':
      current.resume(performance.now());
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
      respond(message.requestId, current.editWorld(message.actorId, message.edits), { gameplay: true, commits: true });
      break;
    case 'set-player-position':
      current.setPlayerPosition(message.position);
      if (message.requestId !== undefined) respond(message.requestId, { moved: true }, { gameplay: true });
      break;
    case 'gameplay-action':
      respond(message.requestId, current.performAction(message.action), { gameplay: true, commits: true });
      break;
    case 'server-command': {
      const result = await new ServerCommandExecutor(current.server).execute(message.source, message.command);
      respond(message.requestId, result, { gameplay: true, commits: true });
      break;
    }
    case 'set-world-time': {
      const worldTime = current.server.setWorldTime(message.hours);
      if (message.requestId !== undefined) respond(message.requestId, { worldTime });
      break;
    }
    case 'advance-world-clock':
      current.server.advanceClock(message.hours);
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
      current.receiveLogicIntents(message.epoch, message.intents);
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

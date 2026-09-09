/// <reference lib="webworker" />

import { BrowserChunkPersistence, type SerializedChunkSnapshot } from '../client/persistence/browser-chunk-persistence';
import {
  AuthorityRuntime,
  type AuthorityInitialWorldBootstrap,
} from '@seedlands/game-core/server/authority/authority-runtime';
import { PROTOCOL_VERSION } from '@seedlands/game-core/runtime/session-protocol';
import type { AuthorityRequest, AuthorityResponse } from '@seedlands/game-core/compute/authority-worker-protocol';
import { commitFluidCandidateAndPublish } from './authority-commit-publisher';
import { browserCorePlatform } from '../platform/core-platform';
import { MemoryGamePersistence } from '@seedlands/game-core/server/persistence/memory-game-persistence';
import type { FrozenGameSaveSnapshot } from '@seedlands/game-core/server/persistence/game-save-snapshot';
import {
  AuthorityWorldHarness,
  type AuthorityWorldOwner,
} from '@seedlands/game-core/server/harness/authority-world-harness';
import {
  WorldResourceAuthorizer,
  developmentWorldAuthorizationPolicy,
} from '@seedlands/game-core/server/harness/world-authorization';
import { dispatchWorldHarnessRpc } from '@seedlands/game-core/server/harness/world-harness-jsonl';
import { BrowserAuthorityIngress, rejectStaleAuthorityMessage } from './authority-worker-ingress';
import { SwitchableAuthorityPersistence } from './authority-worker-persistence';
import type { AuthorityPersistence } from '@seedlands/game-core/server/authority/authority-runtime-options';
import { decodeAuthorityBootstrapResult } from './authority-worker-bootstrap';
import { postAuthorityFailure, postAuthoritySuccess, transactAuthorityRequest } from './authority-worker-response';

const scope = self as DedicatedWorkerGlobalScope;
let runtime: AuthorityRuntime | null = null;
let persistence: BrowserChunkPersistence | null = null;
let worldHarness: AuthorityWorldHarness | null = null;
let worldEpoch = '';
let worldRestoreSequence = 0;
let interval: ReturnType<typeof setInterval> | null = null;
let epoch = '';
let runtimeEpoch = '';
let fluidEpoch = 1;
let ingress: BrowserAuthorityIngress | null = null;
let lastSnapshotPublishedAt = Number.NEGATIVE_INFINITY;
let lastGameplayPublishedAt = Number.NEGATIVE_INFINITY;
let bootstrapRequestSequence = 0;
let pendingBootstrap: {
  requestId: number;
  resolve: (bootstrap: AuthorityInitialWorldBootstrap) => void;
  reject: (error: Error) => void;
} | null = null;
let tickQueued = false;

const post = (message: AuthorityResponse, transfer: Transferable[] = []) => scope.postMessage(message, transfer);

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

const assertCurrent = (message: AuthorityRequest) => {
  if (!runtime || message.epoch !== epoch) throw new Error('Authority session is unavailable or stale.');
  return runtime;
};

const transact = async (
  message: Parameters<typeof transactAuthorityRequest>[4],
  operation: Parameters<typeof transactAuthorityRequest>[5],
) => transactAuthorityRequest(post, epoch, runtimeEpoch, runtime!, message, operation);

const fail = (requestId: number, error: unknown) => postAuthorityFailure(post, epoch, requestId, error);

const tick = () => {
  if (!runtime || !worldHarness || tickQueued) return;
  tickQueued = true;
  void worldHarness
    .hostOperation(() => {
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
    })
    .catch((failure) =>
      post({ kind: 'authority-fatal', protocolVersion: PROTOCOL_VERSION, epoch, error: errorText(failure) }),
    )
    .finally(() => (tickQueued = false));
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

const createRuntime = (
  seedText: string,
  generatorVersion: number,
  initialWorldTime: number,
  runtimePersistence: AuthorityPersistence,
  candidateEpoch = runtimeEpoch,
  candidateFluidEpoch = fluidEpoch,
) =>
  AuthorityRuntime.create({
    epoch: candidateEpoch,
    seedText,
    generatorVersion,
    persistence: runtimePersistence,
    initialWorldTime,
    frequencies: runtime?.frequencies ?? { physicsHz: 60, gameplayHz: 20, fluidHz: 30 },
    startTimeMs: 0,
    startClock: browserCorePlatform.now,
    platform: browserCorePlatform,
    fluidEpoch: candidateFluidEpoch,
    findInitialWorldBootstrap: requestBootstrap,
    onFluidWork: (snapshot) => post({ kind: 'fluid-work', protocolVersion: PROTOCOL_VERSION, epoch, snapshot }),
    onLogicObservation: (observation) =>
      worldHarness?.acceptsAutomaticLogic() === false
        ? undefined
        : post(
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

const restoreWorld = async (snapshot: FrozenGameSaveSnapshot) => {
  const currentPersistence = persistence!;
  const temporary = new MemoryGamePersistence({ clone: browserCorePlatform.clone });
  temporary.saveFrozenSnapshot(snapshot);
  const candidatePersistence = new SwitchableAuthorityPersistence(temporary);
  const nextRestoreSequence = worldRestoreSequence + 1;
  const nextRuntimeEpoch = `${epoch}:runtime:${nextRestoreSequence}`;
  const nextFluidEpoch = fluidEpoch + 1;
  const candidate = await createRuntime(
    snapshot.seedText,
    snapshot.generatorVersion,
    snapshot.gameplay.worldTime ?? 9,
    candidatePersistence,
    nextRuntimeEpoch,
    nextFluidEpoch,
  );
  await currentPersistence.replaceFrozenSnapshot(snapshot);
  candidatePersistence.replace(currentPersistence);
  candidate.commitHostActivation();
  candidate.pause(candidate.sessionTimeMs);
  candidate.clearPlayerInput();
  runtime = candidate;
  ingress = new BrowserAuthorityIngress(candidate.playerId);
  worldRestoreSequence = nextRestoreSequence;
  runtimeEpoch = nextRuntimeEpoch;
  fluidEpoch = nextFluidEpoch;
  worldEpoch = `${epoch}:world:${worldRestoreSequence}`;
};

const start = async (message: Extract<AuthorityRequest, { kind: 'start-authority' }>) => {
  if (runtime || persistence) throw new Error('Authority Worker already owns a running session.');
  epoch = message.epoch;
  runtimeEpoch = epoch;
  fluidEpoch = 1;
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
    startClock: browserCorePlatform.now,
    platform: browserCorePlatform,
    fluidEpoch,
    findInitialWorldBootstrap: requestBootstrap,
    onFluidWork: (snapshot) => post({ kind: 'fluid-work', protocolVersion: PROTOCOL_VERSION, epoch, snapshot }),
    onLogicObservation: (observation) =>
      worldHarness?.acceptsAutomaticLogic() === false
        ? undefined
        : post(
            { kind: 'logic-observation', protocolVersion: PROTOCOL_VERSION, epoch, observation },
            observation.decisionContext.terrainWindows.map((window) => window.occupancy.buffer),
          ),
    onUnknownChunk: (key) => post({ kind: 'authority-chunk-needed', protocolVersion: PROTOCOL_VERSION, epoch, key }),
  });
  worldEpoch = `${epoch}:world:0`;
  const principalId = 'browser-developer';
  const policy = message.developerWorldHarness
    ? developmentWorldAuthorizationPolicy(principalId, runtime.playerId)
    : { principals: [{ id: principalId, boundEntityId: runtime.playerId }], rules: [] };
  worldHarness = new AuthorityWorldHarness({
    platform: browserCorePlatform,
    principalId,
    authorization: new WorldResourceAuthorizer(policy),
    owner: (): AuthorityWorldOwner => ({ runtime: runtime!, epoch: worldEpoch, worldId: persistence!.worldId }),
    prepareChunk: async ([cx, cy, cz]) => {
      if (!(await runtime!.prepareHarnessChunks([[cx, cy, cz]])))
        throw new Error(`Authority Chunk is unavailable: ${cx},${cy},${cz}.`);
    },
    advance: async (elapsedMs) => runtime!.advancePausedSession(elapsedMs),
    restore: restoreWorld,
    clockNow: browserCorePlatform.now,
  });
  ingress = new BrowserAuthorityIngress(runtime.playerId);
  post({ kind: 'authority-ready', protocolVersion: PROTOCOL_VERSION, epoch, ready: runtime.ready() });
  interval = setInterval(tick, 8);
};

const handleCurrent = async (message: AuthorityRequest) => {
  const current = assertCurrent(message);
  switch (message.kind) {
    case 'input':
      ingress!.input(message);
      {
        const { runtimeEpoch: inputEpoch, ...transportInput } = message;
        post({
          kind: 'input-decision',
          protocolVersion: PROTOCOL_VERSION,
          epoch,
          sequence: message.sequence,
          decision: current.receiveInput({ ...transportInput, epoch: inputEpoch }),
          requiresResync: current.inputResyncRequired,
        });
      }
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
      if (result.status === 'unavailable') postAuthoritySuccess(post, epoch, current, message.requestId, result);
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
      postAuthoritySuccess(post, epoch, current, message.requestId, {
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
      ingress!.fluid('control');
      current.setFluidActiveChunks(message.keys);
      break;
    case 'world-edit':
      ingress!.worldEdit(message.actorId, message.edits);
      await transact(message, async () => ({
        result: await current.editWorld(message.actorId, message.edits),
        gameplay: current.view(),
        commits: current.takeCommits(),
      }));
      break;
    case 'set-player-position':
      ingress!.position();
      await transact(message, () => {
        current.setPlayerPosition(message.position);
        return { result: { moved: true, snapshot: current.wake(performance.now()) }, gameplay: current.view() };
      });
      break;
    case 'gameplay-action': {
      ingress!.action(message.action);
      await transact(message, async () => {
        const result = await current.performAction(message.action);
        return { result, gameplay: result.gameplay, commits: [...result.commits] };
      });
      break;
    }
    case 'server-command': {
      const commandSource = ingress!.command(
        message.command,
        (actionId) => current.server.getAction(actionId)?.actorId ?? null,
      );
      await transact(message, async () => ({
        result: await current.executeCommand(commandSource, message.command),
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
      postAuthoritySuccess(post, epoch, current, message.requestId, await current.save(), { gameplay: true });
      break;
    case 'fluid-candidate':
      ingress!.fluid('execute');
      commitFluidCandidateAndPublish(epoch, current, message.candidate, post);
      worldHarness?.notifyProgress();
      break;
    case 'fluid-failure':
      ingress!.fluid('execute');
      current.abortFluidWork(message.workId, message.reason);
      worldHarness?.notifyProgress();
      break;
    case 'logic-intents':
      ingress!.logic();
      if (worldHarness?.acceptsAutomaticLogic() !== false) current.receiveLogicIntentBatch(message.batch);
      worldHarness?.notifyProgress();
      break;
    case 'request-logic-observation':
      ingress!.logic();
      current.requestLogicObservation();
      break;
  }
};

const handle = async (message: AuthorityRequest) => {
  if (!message || message.protocolVersion !== PROTOCOL_VERSION) return;
  if (message.kind === 'start-authority') return start(message);
  if (message.kind === 'authority-bootstrap-result') {
    if (message.epoch !== epoch || !pendingBootstrap || message.requestId !== pendingBootstrap.requestId) return;
    const pending = pendingBootstrap;
    pendingBootstrap = null;
    try {
      pending.resolve(decodeAuthorityBootstrapResult(message));
    } catch (error) {
      pending.reject(error instanceof Error ? error : new Error(String(error)));
    }
    return;
  }
  if (!runtime || message.epoch !== epoch) throw new Error('Authority session is unavailable or stale.');
  if (message.kind === 'world-harness-rpc') {
    if (!worldHarness) throw new Error('World Harness is unavailable.');
    if (message.runtimeEpoch !== runtimeEpoch) {
      fail(message.requestId, new Error('WORLD_EPOCH_STALE: World request was submitted for a stale runtime epoch.'));
      return;
    }
    const result = await dispatchWorldHarnessRpc(worldHarness, {
      protocolVersion: 1,
      requestId: message.requestId,
      method: message.method,
      args: message.args,
    });
    post({
      kind: 'world-harness-response',
      protocolVersion: PROTOCOL_VERSION,
      epoch,
      requestId: message.requestId,
      result: result.result,
      ...(message.method === 'checkpoint' &&
      result.result.ok &&
      result.result.data &&
      typeof result.result.data === 'object' &&
      'restored' in result.result.data
        ? { ready: runtime!.ready(), runtimeEpoch }
        : {}),
    });
    return;
  }
  if (message.kind === 'dispose-authority') {
    if (interval !== null) clearInterval(interval);
    interval = null;
    persistence?.dispose();
    persistence = null;
    pendingBootstrap?.reject(new Error('Authority Worker was disposed during bootstrap.'));
    pendingBootstrap = null;
    worldHarness = null;
    ingress = null;
    runtime = null;
    scope.close();
    return;
  }
  if (!worldHarness) throw new Error('World Harness is unavailable.');
  const dispatchCurrent = async () => {
    if (message.runtimeEpoch !== runtimeEpoch) {
      if ('requestId' in message && typeof message.requestId === 'number')
        fail(
          message.requestId,
          new Error('WORLD_EPOCH_STALE: Authority request was submitted for a stale runtime epoch.'),
        );
      else rejectStaleAuthorityMessage(message, epoch, post);
      return;
    }
    await handleCurrent(message);
  };
  // Canonical completion resolves a prepare operation that may own the command queue.
  // It stays on this Authority writer and keeps the same epoch/revision validation.
  if (message.kind === 'accept-generated-chunk') {
    await dispatchCurrent();
    worldHarness.notifyProgress();
  } else await worldHarness.hostOperation(dispatchCurrent);
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

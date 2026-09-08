import { performance } from 'node:perf_hooks';
import { Buffer } from 'node:buffer';
import { WebSocket, type RawData } from 'ws';
import type { AuthorityActionResult } from '@seedlands/game-core/compute/authority-worker-protocol';
import type { AuthoritySnapshot } from '@seedlands/game-core/server/authority/authority-session';
import type { WorldCommitResult } from '@seedlands/game-core/server/game-server-types';
import type { InputCommand, SequenceDecision } from '@seedlands/game-core/runtime/session-protocol';
import {
  decodeC0Envelope,
  encodeC0Envelope,
  type C0BinaryBlock,
} from '@seedlands/game-core/server/protocol/network-c0-codec';
import type {
  NetworkMessageClass,
  PublicInboundMessage,
  PublicSessionRef,
} from '@seedlands/game-core/server/protocol/network-message-semantics';
import { projectPlayerCorrectionReference } from '@seedlands/game-core/server/protocol/network-reference-projection';
import { projectGameplayConsumerReference } from '@seedlands/game-core/server/protocol/network-gameplay-consumer-reference';
import { projectWorldCommitPresentationReference } from '@seedlands/game-core/server/protocol/network-reference-world-commit-presentation';
import { projectActionReceiptReference } from '@seedlands/game-core/server/protocol/network-action-reference';
import type { NodeAuthorityLane, NodeAuthorityPublication } from '../runtime/node-authority-lane';
import { nodeCorePlatform } from '../runtime/node-core-platform';
import { createPlayableBaselineSender } from './node-playable-network-baseline';
import {
  MAX_PLAYABLE_FRAME_BYTES,
  MAX_PLAYABLE_SEND_QUEUE_BYTES,
  playableNetworkLimits,
} from './node-playable-network-limits';
import { createPlayableNetworkRateLimit } from './node-playable-network-rate-limit';

const MAX_PENDING_REQUESTS = 32;
const MAX_PENDING_CHECKPOINT_REQUESTS = 1;
const IDLE_TIMEOUT_MS = 15_000;

const bytes = (raw: RawData): Uint8Array | null => {
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
  if (Array.isArray(raw)) return new Uint8Array(Buffer.concat(raw));
  if (ArrayBuffer.isView(raw)) return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  return null;
};

const sameRef = (left: PublicSessionRef, right: PublicSessionRef) =>
  left.protocolVersion === right.protocolVersion &&
  left.sessionEpoch === right.sessionEpoch &&
  left.worldId === right.worldId &&
  left.playerId === right.playerId;

export const projectGameplay = (publication: Pick<NodeAuthorityPublication, 'snapshot' | 'gameplay'>) =>
  publication.gameplay
    ? projectGameplayConsumerReference(publication.gameplay, {
        epoch: publication.snapshot.epoch,
        snapshotPhysicsTick: publication.snapshot.physicsTick,
        snapshotCommitSequence: publication.snapshot.commitSequence,
        snapshotWorldRevision: publication.snapshot.worldRevision,
      })
    : undefined;

const projectCommits = (snapshot: AuthoritySnapshot, commits: readonly WorldCommitResult[]) =>
  commits.map((commit) =>
    projectWorldCommitPresentationReference(commit, {
      epoch: snapshot.epoch,
      publicationCommitSequenceUpperBound: snapshot.commitSequence,
    }),
  );
export function createSession(
  socket: WebSocket,
  authority: NodeAuthorityLane,
  ref: PublicSessionRef,
  ready: Awaited<ReturnType<NodeAuthorityLane['readReady']>>,
  serverEpoch: string,
  onTerminal: () => void,
  allocateInputSequence: () => number,
  allocateActionSequence: () => number,
  allocateCaptureId: () => number,
) {
  const interestRef = Object.freeze({
    epoch: serverEpoch,
    serverEpoch,
    sessionId: ref.sessionEpoch,
    worldId: ref.worldId,
  });
  const inputMappings = new Map<number, number>();
  const actions = new Map<
    number,
    { fingerprint: string; promise: Promise<Record<string, unknown>>; settled: boolean }
  >();
  const pendingCaptures = new Map<number, number>();
  const baselineRequests = new Set<number>();
  const cancelledBaselineRequests = new Set<number>();
  let lastClientInputSequence = -1;
  let clientAcknowledgedInputSequence = -1;
  let lastClientEdgeId = -1;
  let pendingJumpEdge: { edgeId: number; targetPhysicsTick: number; expiresAfterPhysicsTick: number } | null = null;
  let actionRequestHighWatermark = -1;
  let interestRequestHighWatermark = -1;
  let interestCancelHighWatermark = -1;
  let checkpointRequestHighWatermark = -1;
  let pendingCheckpointRequests = 0;
  let publicationSequence = -1;
  let queuedBytes = 0;
  let outbound = Promise.resolve();
  let baselineTail = Promise.resolve();
  let closed = false;
  let resolveClosed!: () => void;
  const closedSignal = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
  let lastInboundAt = performance.now();
  const consumeRate = createPlayableNetworkRateLimit(playableNetworkLimits);
  const idle = setInterval(() => {
    if (performance.now() - lastInboundAt > IDLE_TIMEOUT_MS) close(4000, 'idle');
  }, 1_000);

  const enqueue = (
    messageClass: NetworkMessageClass,
    message: Readonly<Record<string, unknown>>,
    blocks: readonly C0BinaryBlock[] = [],
  ): Promise<void> => {
    if (closed) return Promise.reject(new Error('Network session is closed.'));
    const encoded = encodeC0Envelope({ messageClass, message, blocks }, nodeCorePlatform.utf8);
    if (
      queuedBytes + encoded.byteLength > MAX_PLAYABLE_SEND_QUEUE_BYTES ||
      socket.bufferedAmount > MAX_PLAYABLE_SEND_QUEUE_BYTES
    ) {
      close(4001, 'backpressure');
      return Promise.reject(new Error('Network send queue exceeded its budget.'));
    }
    queuedBytes += encoded.byteLength;
    const sending = outbound.then(
      () =>
        new Promise<void>((resolve, reject) => {
          if (closed || socket.readyState !== WebSocket.OPEN) return reject(new Error('Network socket is closed.'));
          socket.send(encoded, { binary: true, compress: false }, (error) => (error ? reject(error) : resolve()));
        }),
    );
    outbound = sending
      .catch(() => undefined)
      .finally(() => {
        queuedBytes -= encoded.byteLength;
      });
    return sending;
  };

  const baselines = createPlayableBaselineSender({
    authority,
    transportRef: ref,
    interestRef,
    generatorVersion: ready.generatorVersion,
    allocateCaptureId,
    setCapture: (requestId, captureId) => {
      if (captureId === null) pendingCaptures.delete(requestId);
      else pendingCaptures.set(requestId, captureId);
    },
    isCancelled: (requestId) => closed || cancelledBaselineRequests.has(requestId),
    enqueue,
  });

  const close = (code = 1000, reason = 'closed') => {
    if (closed) return;
    closed = true;
    resolveClosed();
    clearInterval(idle);
    baselines.close();
    for (const captureId of pendingCaptures.values())
      void authority.cancelBaselineCapture(captureId).catch(() => undefined);
    pendingCaptures.clear();
    socket.close(code, reason.slice(0, 120));
    onTerminal();
  };

  const clientAcknowledgement = (serverAcknowledgement: number): number => {
    for (const [server, local] of inputMappings) {
      if (server > serverAcknowledgement) continue;
      clientAcknowledgedInputSequence = Math.max(clientAcknowledgedInputSequence, local);
      inputMappings.delete(server);
    }
    return clientAcknowledgedInputSequence;
  };

  const publish = (publication: Readonly<NodeAuthorityPublication>) => {
    if (publication.resyncRequired) {
      void enqueue('resync-required', {
        kind: 'resync-required',
        ref,
        reason: 'sequence-gap',
      }).then(
        () => close(4002, 'resync-required'),
        () => close(4002, 'resync-required'),
      );
      return;
    }
    const correction = projectPlayerCorrectionReference(publication.snapshot);
    correction.acknowledgedInputSequence = clientAcknowledgement(publication.snapshot.acknowledgedInputSequence);
    void enqueue('authority-state', {
      kind: 'authority-state',
      ref,
      publicationSequence: ++publicationSequence,
      correction,
      ...(publication.gameplay ? { gameplay: projectGameplay(publication) } : {}),
      commits: projectCommits(publication.snapshot, publication.commits),
    }).catch(() => close(4001, 'send-failed'));
  };

  const handleAction = async (message: Extract<PublicInboundMessage, { kind: 'player-action' }>) => {
    const fingerprint = JSON.stringify([message.action, message.expectedCommitSequence ?? null]);
    const existing = actions.get(message.requestId);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new Error('Action requestId was reused with another payload.');
      await enqueue('action-receipt', await existing.promise);
      return;
    }
    if (message.requestId <= actionRequestHighWatermark) throw new Error('Action requestId is expired.');
    actionRequestHighWatermark = message.requestId;
    if (actions.size >= 256) {
      const oldest = actions.entries().next().value as
        [number, { fingerprint: string; promise: Promise<Record<string, unknown>>; settled: boolean }] | undefined;
      if (!oldest?.[1].settled) throw new Error('Action receipt window is at capacity.');
      actions.delete(oldest[0]);
    }
    const actionSequence = allocateActionSequence();
    const promise = authority
      .performAction(message.action, actionSequence, message.expectedCommitSequence)
      .then((receipt) => {
        const executed = receipt.status === 'executed' ? (receipt.result as AuthorityActionResult) : undefined;
        return {
          kind: 'action-receipt',
          ref,
          requestId: message.requestId,
          receipt: projectActionReceiptReference(message.action, receipt, {
            epoch: serverEpoch,
            issuer: ready.playerId,
            stream: 'player-actions',
            sequence: actionSequence,
          }),
          ...(executed
            ? {
                gameplay: projectGameplay({
                  snapshot: authority.latestSnapshot() ?? ready.snapshot,
                  gameplay: executed.gameplay,
                }),
              }
            : {}),
          commits: executed ? projectCommits(authority.latestSnapshot() ?? ready.snapshot, executed.commits) : [],
        } satisfies Record<string, unknown>;
      });
    const state = { fingerprint, promise, settled: false };
    actions.set(message.requestId, state);
    void promise.then(
      () => {
        state.settled = true;
      },
      () => {
        state.settled = true;
      },
    );
    await enqueue('action-receipt', await promise);
  };

  const handle = async (message: PublicInboundMessage) => {
    if (closed) return;
    if (message.kind === 'session-hello') throw new Error('Session hello cannot be repeated.');
    if (!sameRef(message.ref, ref)) throw new Error('Session reference does not match the active connection.');
    lastInboundAt = performance.now();
    if (message.kind === 'input-state') {
      let decision: SequenceDecision;
      if (message.inputSequence <= lastClientInputSequence) decision = 'out-of-order';
      else if (message.targetPhysicsTick > message.expiresAfterPhysicsTick) decision = 'invalid';
      else {
        const currentTick = authority.latestSnapshot()?.physicsTick ?? ready.snapshot.physicsTick;
        if (message.expiresAfterPhysicsTick <= currentTick || message.targetPhysicsTick <= currentTick)
          decision = 'late';
        else if (message.targetPhysicsTick > currentTick + 120) decision = 'too-far-ahead';
        else {
          lastClientInputSequence = message.inputSequence;
          const serverSequence = allocateInputSequence();
          const jumpPressed = Boolean(
            pendingJumpEdge &&
            pendingJumpEdge.targetPhysicsTick <= message.targetPhysicsTick &&
            pendingJumpEdge.expiresAfterPhysicsTick >= message.targetPhysicsTick,
          );
          if (pendingJumpEdge && pendingJumpEdge.targetPhysicsTick <= message.targetPhysicsTick) pendingJumpEdge = null;
          const input: InputCommand = {
            kind: 'input',
            protocolVersion: 1,
            epoch: serverEpoch,
            stream: 'player-input',
            sequence: serverSequence,
            targetPhysicsTick: message.targetPhysicsTick,
            issuedAtMs: performance.now(),
            state: {
              moveX: message.moveX,
              moveZ: message.moveZ,
              verticalIntent: message.verticalIntent,
              jumpHeld: message.jumpHeld,
            },
            edges: { jumpPressed },
          };
          decision = await authority.receiveInput(input);
          if (decision === 'accepted') inputMappings.set(serverSequence, message.inputSequence);
        }
      }
      await enqueue('input-decision', {
        kind: 'input-decision',
        ref,
        inputSequence: message.inputSequence,
        decision,
        requiresResync: decision !== 'accepted' && decision !== 'duplicate',
      });
      return;
    }
    if (message.kind === 'input-edge') {
      const currentTick = authority.latestSnapshot()?.physicsTick ?? ready.snapshot.physicsTick;
      if (message.edgeId <= lastClientEdgeId) return;
      lastClientEdgeId = message.edgeId;
      if (message.targetPhysicsTick <= currentTick || message.expiresAfterPhysicsTick <= currentTick) return;
      if (message.targetPhysicsTick > currentTick + 120 || message.expiresAfterPhysicsTick < message.targetPhysicsTick)
        throw new Error('Input edge is stale or invalid.');
      pendingJumpEdge = {
        edgeId: message.edgeId,
        targetPhysicsTick: message.targetPhysicsTick,
        expiresAfterPhysicsTick: message.expiresAfterPhysicsTick,
      };
      return;
    }
    if (message.kind === 'player-action') return handleAction(message);
    if (message.kind === 'interest-update') {
      if (message.requestId <= interestRequestHighWatermark || baselineRequests.has(message.requestId))
        throw new Error('Interest requestId must be strictly increasing.');
      if (baselineRequests.size >= MAX_PENDING_REQUESTS) throw new Error('Too many pending baseline requests.');
      interestRequestHighWatermark = message.requestId;
      baselineRequests.add(message.requestId);
      const next = baselineTail.then(() => Promise.race([baselines.send(message), closedSignal]));
      baselineTail = next.then(
        () => {
          baselineRequests.delete(message.requestId);
          cancelledBaselineRequests.delete(message.requestId);
        },
        () => {
          baselineRequests.delete(message.requestId);
          cancelledBaselineRequests.delete(message.requestId);
        },
      );
      return next;
    }
    if (message.kind === 'interest-cancel') {
      if (message.requestId <= interestCancelHighWatermark)
        throw new Error('Interest cancellation requestId must be strictly increasing.');
      interestCancelHighWatermark = message.requestId;
      if (!baselineRequests.has(message.targetRequestId)) return;
      cancelledBaselineRequests.add(message.targetRequestId);
      const captureId = pendingCaptures.get(message.targetRequestId);
      if (captureId !== undefined) await authority.cancelBaselineCapture(captureId);
      return;
    }
    if (message.kind === 'checkpoint-request') {
      if (message.requestId <= checkpointRequestHighWatermark)
        throw new Error('Checkpoint requestId must be strictly increasing.');
      if (pendingCheckpointRequests >= MAX_PENDING_CHECKPOINT_REQUESTS)
        throw new Error('A checkpoint request is already pending.');
      checkpointRequestHighWatermark = message.requestId;
      pendingCheckpointRequests += 1;
      try {
        const result = (await authority.requestCheckpoint()) as { commitSequence: number };
        await enqueue('checkpoint-receipt', {
          kind: 'checkpoint-receipt',
          ref,
          requestId: message.requestId,
          durableCommitSequence: result.commitSequence,
        });
      } finally {
        pendingCheckpointRequests -= 1;
      }
      return;
    }
    if (message.kind === 'heartbeat') {
      await enqueue('heartbeat-receipt', { kind: 'heartbeat-receipt', ref, nonce: message.nonce });
      return;
    }
    if (message.kind === 'resync-request') {
      await enqueue('resync-required', { kind: 'resync-required', ref, reason: message.reason });
      close(4002, 'resync-required');
      return;
    }
    close(1000, message.reason);
  };

  const listener = Object.assign(publish, { onFailure: () => close(4001, 'publication-failed') });
  const unsubscribe = authority.subscribePublication(listener);
  const terminal = () => {
    unsubscribe();
    close();
  };
  socket.once('close', terminal);
  socket.once('error', terminal);
  socket.on('message', (raw, isBinary) => {
    if (!isBinary) return close(4003, 'binary-required');
    const value = bytes(raw);
    if (!value || value.byteLength > MAX_PLAYABLE_FRAME_BYTES) return close(4003, 'frame-limit');
    let decoded;
    try {
      decoded = decodeC0Envelope(value, nodeCorePlatform.utf8);
    } catch {
      return close(4003, 'protocol');
    }
    const message = decoded.message as PublicInboundMessage;
    if (!consumeRate(message.kind === 'player-action')) return close(4003, 'rate-limit');
    void handle(message).catch((error) =>
      close(4003, `protocol:${error instanceof Error ? error.message : 'unknown'}`),
    );
  });

  return {
    ref,
    enqueue,
    publish,
    close,
    whenDrained: () => Promise.all([outbound, baselineTail]).then(() => undefined),
  };
}

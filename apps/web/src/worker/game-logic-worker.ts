/// <reference lib="webworker" />

import { decideLogicIntents } from '@seedlands/stdlib/server/logic/logic-decision';
import {
  LOGIC_PROTOCOL_VERSION,
  type LogicWorkerRequest,
  type LogicWorkerResponse,
} from '@seedlands/stdlib/server/logic/logic-protocol';
import {
  DIRECT_LOGIC_PROTOCOL_VERSION,
  type DirectLogicAttachRequest,
  type DirectLogicMessage,
} from './authority-worker-direct-logic-protocol';

type HandlerOptions = Readonly<{
  postMessage: (message: LogicWorkerResponse) => void;
  nowMs?: () => number;
  close?: () => void;
}>;

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function createGameLogicWorkerHandler(options: HandlerOptions) {
  let epoch: string | null = null;
  let harnessEnabled = false;
  let physicsHz: 30 | 60 | 120 | null = null;
  let disposed = false;
  let directPort: MessagePort | null = null;
  let directAttachEpoch: string | null = null;
  const nowMs = options.nowMs ?? (() => performance.now());
  const fatal = (messageEpoch: string, error: unknown) =>
    options.postMessage({
      kind: 'logic-fatal',
      protocolVersion: LOGIC_PROTOCOL_VERSION,
      epoch: messageEpoch,
      error: errorText(error),
    });

  const closeDirect = () => {
    if (!directPort) return;
    const port = directPort;
    directPort = null;
    port.onmessage = null;
    port.onmessageerror = null;
    try {
      port.close();
    } catch {
      // Local ownership has already been released.
    }
  };
  const failDirect = (error: unknown) => {
    fatal(epoch ?? directAttachEpoch ?? '', error);
    disposed = true;
    closeDirect();
    options.close?.();
  };
  const receiveDirect = (message: DirectLogicMessage) => {
    if (disposed || !message || message.protocolVersion !== DIRECT_LOGIC_PROTOCOL_VERSION) return;
    try {
      if (epoch === null || physicsHz === null) throw new Error('Game Logic Worker must be initialized before use.');
      if (message.kind === 'direct-logic-reset') {
        if (message.epoch !== epoch || !message.nextEpoch.trim()) return;
        epoch = message.nextEpoch;
        return;
      }
      if (message.kind !== 'direct-logic-observation') throw new Error('Direct Logic message direction is invalid.');
      if (message.observation.epoch !== epoch) return;
      directPort!.postMessage({
        kind: 'direct-logic-intents',
        protocolVersion: DIRECT_LOGIC_PROTOCOL_VERSION,
        batch: decideLogicIntents(message.observation, { physicsHz }),
      } satisfies DirectLogicMessage);
    } catch (error) {
      failDirect(error);
    }
  };

  return (message: LogicWorkerRequest | DirectLogicAttachRequest): void => {
    if (disposed || !message) return;
    if (message.kind === 'attach-direct-logic') {
      if (message.protocolVersion !== DIRECT_LOGIC_PROTOCOL_VERSION) return;
      if (directPort) return failDirect(new Error('Direct Logic port is already attached.'));
      if (!message.epoch.trim()) return failDirect(new TypeError('Direct Logic attach epoch must not be empty.'));
      directAttachEpoch = message.epoch;
      directPort = message.port;
      directPort.onmessage = (event) => receiveDirect(event.data as DirectLogicMessage);
      directPort.onmessageerror = () => failDirect(new Error('Direct Logic port could not decode a message.'));
      try {
        directPort.start();
      } catch (error) {
        failDirect(error);
      }
      return;
    }
    if (message.protocolVersion !== LOGIC_PROTOCOL_VERSION) return;
    try {
      if (message.kind === 'init-logic') {
        if (epoch !== null) throw new Error('Game Logic Worker is already initialized.');
        if (!message.epoch.trim()) throw new TypeError('Logic epoch must not be empty.');
        if (directAttachEpoch !== null && directAttachEpoch !== message.epoch)
          throw new Error('Direct Logic attach epoch does not match initialization.');
        if (![30, 60, 120].includes(message.physicsHz)) throw new TypeError('Logic physics frequency is invalid.');
        epoch = message.epoch;
        harnessEnabled = message.harnessEnabled;
        physicsHz = message.physicsHz;
        options.postMessage({ kind: 'logic-ready', protocolVersion: LOGIC_PROTOCOL_VERSION, epoch });
        return;
      }

      const messageEpoch = message.kind === 'logic-observation' ? message.observation.epoch : message.epoch;
      if (epoch === null) throw new Error('Game Logic Worker must be initialized before use.');
      if (messageEpoch !== epoch) return;

      switch (message.kind) {
        case 'reset-logic-epoch':
          if (!message.nextEpoch.trim()) throw new TypeError('Next Logic epoch must not be empty.');
          epoch = message.nextEpoch;
          options.postMessage({ kind: 'logic-ready', protocolVersion: LOGIC_PROTOCOL_VERSION, epoch });
          break;
        case 'logic-observation':
          if (directPort) break;
          options.postMessage({
            kind: 'logic-intents',
            protocolVersion: LOGIC_PROTOCOL_VERSION,
            batch: decideLogicIntents(message.observation, { physicsHz: physicsHz! }),
          });
          break;
        case 'block-for-test': {
          if (!harnessEnabled) throw new Error('block-for-test requires an explicitly enabled harness session.');
          if (!Number.isFinite(message.ms) || message.ms < 0 || message.ms > 5_000)
            throw new TypeError('Harness block duration must be between 0 and 5000 ms.');
          options.postMessage({
            kind: 'logic-block-started',
            protocolVersion: LOGIC_PROTOCOL_VERSION,
            epoch,
            requestId: message.requestId,
          });
          const startedAt = nowMs();
          while (nowMs() - startedAt < message.ms) {
            // Intentional harness-only busy loop used to prove Authority isolation.
          }
          options.postMessage({
            kind: 'logic-block-finished',
            protocolVersion: LOGIC_PROTOCOL_VERSION,
            epoch,
            requestId: message.requestId,
          });
          break;
        }
        case 'dispose-logic':
          disposed = true;
          closeDirect();
          options.close?.();
          break;
      }
    } catch (error) {
      const messageEpoch =
        message.kind === 'logic-observation'
          ? message.observation.epoch
          : 'epoch' in message
            ? message.epoch
            : (epoch ?? '');
      fatal(messageEpoch, error);
    }
  };
}

const workerScope = globalThis as typeof globalThis & Partial<DedicatedWorkerGlobalScope> & { document?: unknown };
if (
  workerScope.document === undefined &&
  typeof workerScope.postMessage === 'function' &&
  typeof workerScope.close === 'function'
) {
  const scope = workerScope as DedicatedWorkerGlobalScope;
  const handle = createGameLogicWorkerHandler({
    postMessage: (message) => scope.postMessage(message),
    close: () => scope.close(),
  });
  scope.onmessage = (event: MessageEvent<LogicWorkerRequest | DirectLogicAttachRequest>) => handle(event.data);
}

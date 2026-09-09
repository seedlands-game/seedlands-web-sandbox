/// <reference lib="webworker" />

import { decideLogicIntents } from '@seedlands/game-core/server/logic/logic-decision';
import {
  LOGIC_PROTOCOL_VERSION,
  type LogicWorkerRequest,
  type LogicWorkerResponse,
} from '@seedlands/game-core/server/logic/logic-protocol';

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
  const nowMs = options.nowMs ?? (() => performance.now());
  const fatal = (messageEpoch: string, error: unknown) =>
    options.postMessage({
      kind: 'logic-fatal',
      protocolVersion: LOGIC_PROTOCOL_VERSION,
      epoch: messageEpoch,
      error: errorText(error),
    });

  return (message: LogicWorkerRequest): void => {
    if (disposed || !message || message.protocolVersion !== LOGIC_PROTOCOL_VERSION) return;
    try {
      if (message.kind === 'init-logic') {
        if (epoch !== null) throw new Error('Game Logic Worker is already initialized.');
        if (!message.epoch.trim()) throw new TypeError('Logic epoch must not be empty.');
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
  scope.onmessage = (event: MessageEvent<LogicWorkerRequest>) => handle(event.data);
}

import { PROTOCOL_VERSION } from '@seedlands/stdlib/runtime/session-protocol';
import type { PointerAttackDirection, PointerAttackRequest, PointerAttackResponse } from './pointer-attack-protocol';
import type { BrowserMediaFrontier } from './browser-media-frontier';
import type { AuthorityGameplayView } from '@seedlands/stdlib/server/protocol/authority-worker-protocol';
import type { WorldCommitResult } from '@seedlands/stdlib/server/game-server-types';

type State = {
  sequence: number;
  gesture: number;
  held: boolean;
  resultEpoch: string;
  receipts: Set<number>;
  newest: number;
};
const states = new WeakMap<object, State>();
function stateFor(client: object): State {
  const state = states.get(client) ?? {
    sequence: -1,
    gesture: 0,
    held: false,
    resultEpoch: '',
    receipts: new Set<number>(),
    newest: -1,
  };
  states.set(client, state);
  return state;
}

export function sendPointerAttackInput(
  client: object,
  epoch: string,
  runtimeEpoch: string,
  direction: PointerAttackDirection | null,
  post: (message: PointerAttackRequest) => void,
): void {
  const state = stateFor(client);
  if (direction !== null && !state.held) state.gesture += 1;
  state.held = direction !== null;
  post({
    kind: 'pointer-attack-input',
    protocolVersion: PROTOCOL_VERSION,
    epoch,
    runtimeEpoch,
    input: {
      sequence: ++state.sequence,
      gesture: state.gesture,
      capturedAtTimeOriginMs: performance.timeOrigin + performance.now(),
      direction: direction && [...direction],
    },
  });
}

/** Includes reordered receipts so their commits are delivered once; owner view already has its revision gate. */
export function acceptPointerAttackReceipt(
  client: object,
  message: PointerAttackResponse,
  epoch: string,
  runtimeEpoch: string,
): boolean {
  if (
    message.protocolVersion !== PROTOCOL_VERSION ||
    message.epoch !== epoch ||
    message.runtimeEpoch !== runtimeEpoch ||
    !Number.isSafeInteger(message.sequence) ||
    message.sequence < 0
  )
    return false;
  const state = stateFor(client);
  if (state.resultEpoch !== runtimeEpoch) {
    state.resultEpoch = runtimeEpoch;
    state.receipts.clear();
    state.newest = -1;
  }
  if (state.receipts.has(message.sequence) || message.sequence <= state.newest - 64) return false;
  state.receipts.add(message.sequence);
  state.newest = Math.max(state.newest, message.sequence);
  for (const sequence of state.receipts) if (sequence <= state.newest - 64) state.receipts.delete(sequence);
  return true;
}

/** Publish each accepted receipt through the same media, gameplay and commit consumers as regular actions. */
export function consumePointerAttackReceipt(
  message: PointerAttackResponse,
  port: Readonly<{
    media: BrowserMediaFrontier;
    update(view: AuthorityGameplayView, media: ReturnType<BrowserMediaFrontier['clone']>): void;
    publish(commits: readonly WorldCommitResult[]): void;
    result(value: unknown): void;
    fail(error: Error): void;
  }>,
): void {
  const media = port.media.tryClone(message.result.gameplay.media);
  if (!media.ok) return port.fail(media.error);
  port.update(message.result.gameplay, media.value);
  port.publish(message.result.commits);
  port.result(message.result.result);
}

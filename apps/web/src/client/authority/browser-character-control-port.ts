import type { BoundCharacterControlRequest } from '@seedlands/game-core/compute/authority-worker-protocol';
import type {
  CharacterControlResult,
  CharacterGoal,
  ControlBinding,
} from '@seedlands/game-core/runtime/character-control-protocol';
import type { WorldHarnessResult } from '@seedlands/game-core/server/harness/world-harness-contract';
import type { BoundCharacterControlPort } from './browser-authority-client-contract';

type CharacterAuthorityRequest =
  | Readonly<{
      kind: 'bound-character-control';
      binding: ControlBinding;
      sequence: number;
      request: BoundCharacterControlRequest;
    }>
  | Readonly<{ kind: 'unbind-character'; binding: ControlBinding }>;
type Send = (request: CharacterAuthorityRequest) => Promise<unknown>;

export function createBoundCharacterControlPort(binding: ControlBinding, send: Send): BoundCharacterControlPort {
  let disposed = false;
  let sequence = 0;
  const control = (request: BoundCharacterControlRequest) => {
    if (disposed) return Promise.reject(new Error('Character control binding is disposed.'));
    return send({ kind: 'bound-character-control', binding, sequence: ++sequence, request }) as Promise<
      WorldHarnessResult<CharacterControlResult>
    >;
  };
  return Object.freeze({
    binding,
    observe: (sinceCursor?: number) =>
      control({ kind: 'observe', entityId: binding.entityId, ...(sinceCursor === undefined ? {} : { sinceCursor }) }),
    intent: (requestId: string, expectedRevision: number, expectedCursor: number, goal: CharacterGoal, say?: string) =>
      control({
        kind: 'intent',
        entityId: binding.entityId,
        requestId,
        expectedRevision,
        expectedCursor,
        goal,
        ...(say === undefined ? {} : { say }),
      }),
    memory: (expectedMemoryRevision: number, throughCursor: number, summary: string) =>
      control({ kind: 'memory', entityId: binding.entityId, expectedMemoryRevision, throughCursor, summary }),
    dispose: async () => {
      if (disposed) return;
      disposed = true;
      await send({ kind: 'unbind-character', binding });
    },
  });
}

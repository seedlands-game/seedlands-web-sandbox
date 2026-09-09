import type { WorldHarnessError } from './world-harness-contract';
import { WorldBarrierFailure } from './world-barrier-runtime';
import { CheckpointUnavailableFailure, InvalidCheckpointFailure, WorldOperationFailure } from './world-harness-state';
import { CharacterControlFailure } from '../simulation/character-runtime';

export function worldHarnessError(cause: unknown): WorldHarnessError {
  if (
    cause instanceof WorldOperationFailure ||
    cause instanceof WorldBarrierFailure ||
    cause instanceof InvalidCheckpointFailure ||
    cause instanceof CheckpointUnavailableFailure
  )
    return { code: cause.code, message: cause.message, kind: cause.kind };
  if (cause instanceof CharacterControlFailure)
    return {
      code: cause.code,
      message: cause.message,
      kind: cause.code.endsWith('_CONFLICT') ? 'conflict' : 'unavailable',
    };
  const invalid = cause instanceof TypeError || cause instanceof RangeError;
  return {
    code: invalid ? 'WORLD_REQUEST_INVALID' : 'WORLD_EXECUTION_FAILED',
    message: cause instanceof Error ? cause.message : String(cause),
    kind: invalid ? 'validation' : 'execution',
  };
}

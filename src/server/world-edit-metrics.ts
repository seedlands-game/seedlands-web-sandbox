import type { WorldCommitMetrics } from './game-server-types';

const singleEditMetrics = (canonicalWriteCount: 0 | 1, meshInvalidationCount: number): WorldCommitMetrics => ({
  timingStatus: 'not-collected-hot-path',
  inputMutationCount: 1,
  canonicalWriteCount,
  dirtyChunkCount: canonicalWriteCount,
  meshInvalidationCount,
  structuralEventCount: canonicalWriteCount,
  semanticEventCount: 0,
  mutationPayloadBytes: 14,
  mutationCapacityBytes: 14,
  validationMs: 0,
  resolveMs: 0,
  applyMs: 0,
  commitMs: 0,
});
export const SINGLE_EDIT_NOOP_METRICS = Object.freeze(singleEditMetrics(0, 0));
export const SINGLE_EDIT_METRICS = Array.from({ length: 9 }, (_, meshInvalidationCount) =>
  Object.freeze(singleEditMetrics(1, meshInvalidationCount)),
);

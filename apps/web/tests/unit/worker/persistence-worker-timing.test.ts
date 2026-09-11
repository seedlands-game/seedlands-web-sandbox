import { describe, expect, it } from 'vitest';
import { describePersistenceMailboxEncoding } from '../../../src/worker/persistence-worker-timing';

describe('persistence worker timing', () => {
  it('只归因与消息投递区间相交的同步编码而不包含后续异步保存', () => {
    expect(
      describePersistenceMailboxEncoding(150, 510, {
        kind: 'save-frozen',
        encodeStartedAtEpochMs: 200,
        encodeCompletedAtEpochMs: 500,
      }),
    ).toEqual({
      mailboxEncodingTaskKind: 'save-frozen',
      mailboxEncodingOverlapMs: 300,
      mailboxEncodingDurationMs: 300,
    });
    expect(
      describePersistenceMailboxEncoding(250, 510, {
        kind: 'save-frozen',
        encodeStartedAtEpochMs: 100,
        encodeCompletedAtEpochMs: 200,
      }),
    ).toBeUndefined();
  });
});

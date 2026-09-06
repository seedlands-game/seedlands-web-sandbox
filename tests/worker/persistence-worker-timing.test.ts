import { describe, expect, it } from 'vitest';
import { describePersistenceMailboxBlocker } from '../../src/worker/persistence-worker-timing';

describe('persistence worker timing', () => {
  it('只把与Worker收件前mailbox等待相交的最后完成任务归作blocker', () => {
    expect(
      describePersistenceMailboxBlocker(150, 510, {
        kind: 'save-frozen',
        startedAtEpochMs: 100,
        completedAtEpochMs: 500,
        encodeMs: 320,
      }),
    ).toEqual({
      mailboxBlockerKind: 'save-frozen',
      mailboxBlockerOverlapMs: 350,
      mailboxBlockerEncodeMs: 320,
    });
    expect(
      describePersistenceMailboxBlocker(150, 510, {
        kind: 'save-frozen',
        startedAtEpochMs: 200,
        completedAtEpochMs: 500,
        encodeMs: 290,
      }),
    ).toEqual({
      mailboxBlockerKind: 'save-frozen',
      mailboxBlockerOverlapMs: 300,
      mailboxBlockerEncodeMs: 290,
    });
    expect(
      describePersistenceMailboxBlocker(150, 510, {
        kind: 'save',
        startedAtEpochMs: 50,
        completedAtEpochMs: 149,
        encodeMs: 40,
      }),
    ).toBeUndefined();
  });
});

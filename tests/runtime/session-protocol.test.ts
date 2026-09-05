import { describe, expect, it } from 'vitest';
import {
  PROTOCOL_VERSION,
  EpochSequenceGate,
  TransactionDeduplicator,
  createSessionEpoch,
  type InputCommand,
} from '../../src/runtime/session-protocol';

describe('runtime session protocol', () => {
  it('拒绝旧 epoch、乱序和重复输入', () => {
    const gate = new EpochSequenceGate('world:2');

    expect(gate.accept('world:1', 1)).toBe('wrong-epoch');
    expect(gate.accept('world:2', 1)).toBe('accepted');
    expect(gate.accept('world:2', 1)).toBe('duplicate');
    expect(gate.accept('world:2', 0)).toBe('out-of-order');
    expect(gate.accept('world:2', 2)).toBe('accepted');
  });

  it('事务重复投递只执行一次并复用首个回执', () => {
    const transactions = new TransactionDeduplicator<{ commitSequence: number }>('epoch-a');
    let executions = 0;
    const execute = () => ({ commitSequence: ++executions });

    expect(transactions.execute('epoch-a', 4, execute)).toEqual({ status: 'executed', receipt: { commitSequence: 1 } });
    expect(transactions.execute('epoch-a', 4, execute)).toEqual({
      status: 'duplicate',
      receipt: { commitSequence: 1 },
    });
    expect(executions).toBe(1);
  });

  it('创建非空且递增隔离的会话 epoch', () => {
    expect(createSessionEpoch('world', 1)).toBe('world:1');
    expect(createSessionEpoch('world', 2)).not.toBe(createSessionEpoch('world', 1));
  });

  it('输入命令携带版本、目标 tick、持续状态和按键边沿', () => {
    const command: InputCommand = {
      kind: 'input',
      protocolVersion: PROTOCOL_VERSION,
      epoch: 'world:1',
      sequence: 7,
      targetPhysicsTick: 12,
      issuedAtMs: 200,
      state: { moveX: 1, moveZ: 0, verticalIntent: 0, jumpHeld: true },
      edges: { jumpPressed: true },
    };

    expect(command).toMatchObject({ protocolVersion: 1, sequence: 7, targetPhysicsTick: 12 });
  });
});

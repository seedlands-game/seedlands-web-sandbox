import { describe, expect, it } from 'vitest';
import type { AuthoritySnapshot } from '../../packages/game-core/src/server/authority/authority-session-types';
import {
  projectInputDecisionReference,
  projectPlayerInputReference,
} from '../../packages/game-core/src/server/protocol/network-reference-input';
import { PROTOCOL_VERSION, type InputCommand } from '../../packages/game-core/src/runtime/session-protocol';

const input = (overrides: Partial<InputCommand> = {}): InputCommand => ({
  kind: 'input',
  protocolVersion: PROTOCOL_VERSION,
  epoch: 'client:epoch',
  stream: 'player-input',
  sequence: 7,
  targetPhysicsTick: 42,
  issuedAtMs: 123.5,
  state: { moveX: 0.5, moveZ: -1, verticalIntent: 1, jumpHeld: true },
  edges: { jumpPressed: true },
  ...overrides,
});

const snapshot = (overrides: Partial<AuthoritySnapshot> = {}): AuthoritySnapshot =>
  ({
    epoch: 'server:epoch',
    physicsTick: 40,
    acknowledgedInputSequence: -1,
    inputResyncRequired: false,
    ...overrides,
  }) as AuthoritySnapshot;

describe('network input reference projection', () => {
  it('保留完整合法 InputCommand 的 state 与 edge，并隔离引用和扩展字段', () => {
    const source = {
      ...input(),
      state: { moveX: 0.5, moveZ: -1, verticalIntent: 1 as const, jumpHeld: true },
      edges: { jumpPressed: true },
      ignored: { value: 'not-public' },
    };

    const reference = projectPlayerInputReference(source as InputCommand);

    expect(reference).toEqual({
      kind: 'player-input-reference',
      projectionVersion: 1,
      input: input(),
    });
    expect(reference.input).not.toBe(source);
    expect(reference.input.state).not.toBe(source.state);
    expect(reference.input.edges).not.toBe(source.edges);
    expect(reference.input).not.toHaveProperty('ignored');
    source.state.moveX = 0;
    source.edges.jumpPressed = false;
    expect(reference.input.state.moveX).toBe(0.5);
    expect(reference.input.edges.jumpPressed).toBe(true);
  });

  it.each([
    ['idle sequence', { sequence: -1 }],
    ['unsafe sequence', { sequence: Number.MAX_SAFE_INTEGER + 1 }],
    ['wrong version', { protocolVersion: 2 }],
    ['non-finite time', { issuedAtMs: Number.NaN }],
    ['move out of range', { state: { moveX: 1.1, moveZ: 0, verticalIntent: 0, jumpHeld: false } }],
    ['invalid vertical intent', { state: { moveX: 0, moveZ: 0, verticalIntent: 2, jumpHeld: false } }],
    ['invalid edge', { edges: { jumpPressed: 'yes' } }],
  ] as const)('拒绝 %s，不把内部 idle 或畸形输入写入参考语料', (_, override) => {
    expect(() => projectPlayerInputReference(input(override as Partial<InputCommand>))).toThrow();
  });

  it('将 server epoch 与 wrong-epoch 输入身份并列保留，不把 accepted 改写为 executed 或 ack', () => {
    const source = input({ epoch: 'old-client:epoch', sequence: 8, targetPhysicsTick: 51 });
    const reference = projectInputDecisionReference(source, 'wrong-epoch', snapshot());

    expect(reference).toEqual({
      kind: 'input-decision-reference',
      projectionVersion: 1,
      epoch: 'server:epoch',
      input: {
        epoch: 'old-client:epoch',
        stream: 'player-input',
        sequence: 8,
        targetPhysicsTick: 51,
      },
      decision: 'wrong-epoch',
      observedPhysicsTick: 40,
      observedAcknowledgedInputSequence: -1,
      inputResyncRequired: false,
    });
  });

  it('保留 accepted 与紧邻观测的旧 ack，且拒绝畸形 decision 或 snapshot 边界', () => {
    const accepted = projectInputDecisionReference(input({ epoch: 'server:epoch' }), 'accepted', snapshot());
    expect(accepted.decision).toBe('accepted');
    expect(accepted.observedAcknowledgedInputSequence).toBe(-1);
    expect(() => projectInputDecisionReference(input(), 'accepted', snapshot())).toThrow('accepted input must match');
    expect(() =>
      projectInputDecisionReference(input({ epoch: 'server:epoch', stream: 'other-input' }), 'accepted', snapshot()),
    ).toThrow(/stream/);
    expect(() =>
      projectInputDecisionReference(
        input({ epoch: 'server:epoch', sequence: 7 }),
        'accepted',
        snapshot({ acknowledgedInputSequence: 7 }),
      ),
    ).toThrow(/acknowledged/);
    expect(() =>
      projectInputDecisionReference(
        input({ epoch: 'server:epoch' }),
        'accepted',
        snapshot({ inputResyncRequired: true }),
      ),
    ).toThrow(/resync/);
    expect(() =>
      projectInputDecisionReference(input({ epoch: 'server:epoch' }), 'executed' as never, snapshot()),
    ).toThrow();
    expect(() =>
      projectInputDecisionReference(input(), 'accepted', snapshot({ acknowledgedInputSequence: -2 })),
    ).toThrow();
    expect(() => projectInputDecisionReference(input(), 'accepted', snapshot({ physicsTick: -1 }))).toThrow();
    expect(() =>
      projectInputDecisionReference(input(), 'accepted', snapshot({ inputResyncRequired: 'true' as never })),
    ).toThrow();
  });

  it('拒绝与 gate 直接关系矛盾的 wrong-epoch 和 wrong-stream 决定', () => {
    expect(() => projectInputDecisionReference(input({ epoch: 'server:epoch' }), 'wrong-epoch', snapshot())).toThrow(
      /wrong-epoch/,
    );
    expect(() => projectInputDecisionReference(input(), 'wrong-stream', snapshot())).toThrow(/wrong-stream/);
    expect(
      projectInputDecisionReference(input({ epoch: 'server:epoch', stream: 'other-input' }), 'wrong-stream', snapshot())
        .decision,
    ).toBe('wrong-stream');
  });
});

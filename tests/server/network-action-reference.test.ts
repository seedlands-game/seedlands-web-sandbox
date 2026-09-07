import { describe, expect, it } from 'vitest';
import { AuthorityRuntime } from '../../src/server/authority/authority-runtime';
import { projectActionReceiptReference } from '../../src/server/protocol/network-action-reference';
import type { AuthorityAction } from '../../src/worker/authority-worker-protocol';

const makeRuntime = () =>
  AuthorityRuntime.create({
    epoch: 'action-reference-test',
    seedText: 'action-reference-world',
    initialWorldTime: 8,
    startTimeMs: 0,
    initialPlayerBodyPosition: [0.5, 33, 0.5],
  });
const identity = (runtime: AuthorityRuntime, sequence: number) => ({
  epoch: 'action-reference-test',
  issuer: runtime.playerId,
  stream: 'player-actions',
  sequence,
});

describe('公开动作回执参考投影', () => {
  it('从真实权威事务区分成功与业务失败，排除整个gameplay/内部结果', async () => {
    const runtime = await makeRuntime();
    const action: AuthorityAction = { type: 'select-hotbar', slot: 2 };
    const receipt = await runtime.executeTransaction(identity(runtime, 0), () => runtime.performAction(action));
    const projected = projectActionReceiptReference(action, receipt, identity(runtime, 0));
    expect(projected).toMatchObject({
      status: 'executed',
      action: { type: 'select-hotbar', slot: 2 },
      outcome: { success: true },
    });
    expect(projected).not.toHaveProperty('gameplay');
    expect(JSON.stringify(projected)).not.toMatch(/metrics|diagnostics|actors/);
    const failedAction: AuthorityAction = { type: 'craft', recipeId: 'not-a-recipe' };
    const failed = await runtime.executeTransaction(identity(runtime, 1), () => runtime.performAction(failedAction));
    expect(projectActionReceiptReference(failedAction, failed, identity(runtime, 1))).toMatchObject({
      status: 'executed',
      outcome: { success: false, reason: 'unknown-recipe' },
    });
  });

  it('重复事务投影为原回执而不是再次执行，版本冲突不伪造业务结果', async () => {
    const runtime = await makeRuntime();
    const action: AuthorityAction = { type: 'select-hotbar', slot: 1 };
    const id = identity(runtime, 0);
    const first = await runtime.executeTransaction(id, () => runtime.performAction(action));
    const repeated = await runtime.executeTransaction(id, () => {
      throw new Error('must not repeat');
    });
    expect(projectActionReceiptReference(action, repeated, id)).toEqual(
      projectActionReceiptReference(action, first, id),
    );
    expect(() => projectActionReceiptReference({ type: 'cancel-break' }, repeated, id)).toThrow(/action.*match/);
    expect(() => projectActionReceiptReference({ type: 'select-hotbar', slot: 2 }, repeated, id)).toThrow(
      /action.*match/,
    );
    const conflictId = { ...id, sequence: 1, expectedCommitSequence: 999999 };
    const conflict = await runtime.executeTransaction(conflictId, () => {
      throw new Error('must not execute');
    });
    expect(projectActionReceiptReference(action, conflict, conflictId)).toMatchObject({ status: 'conflict' });
    expect(projectActionReceiptReference(action, conflict, conflictId)).not.toHaveProperty('outcome');
    expect(projectActionReceiptReference(action, conflict, conflictId)).not.toHaveProperty('action');
    expect(projectActionReceiptReference({ type: 'cancel-break' }, conflict, conflictId)).toEqual(
      projectActionReceiptReference(action, conflict, conflictId),
    );
  });

  it('未知业务失败与损坏的动作数据不能经unknown result泄露上网', async () => {
    const runtime = await makeRuntime();
    const action: AuthorityAction = { type: 'cancel-break' };
    const receipt = await runtime.executeTransaction(identity(runtime, 0), () => runtime.performAction(action));
    if (receipt.status !== 'executed') throw new Error('fixture transaction failed');
    const invalid = {
      ...receipt,
      result: { ...receipt.result, result: { success: false, reason: '/private/world/path' } },
    };
    expect(() => projectActionReceiptReference(action, invalid, identity(runtime, 0))).toThrow(/reason/);
    const invalidReason = { ...receipt, result: { ...receipt.result, result: { success: false, reason: 'blocked' } } };
    expect(() => projectActionReceiptReference(action, invalidReason, identity(runtime, 0))).toThrow(/reason/);
    const attack = {
      ...receipt,
      result: {
        ...receipt.result,
        submittedAction: { type: 'attack', targetId: 'fixture' },
        result: { success: true, damage: NaN },
      },
    };
    expect(() =>
      projectActionReceiptReference({ type: 'attack', targetId: 'fixture' }, attack, identity(runtime, 0)),
    ).toThrow(/damage/);
  });

  it('复用请求的 canonical 动作复制，保留最大槽位并拒绝稀疏坐标', async () => {
    const runtime = await makeRuntime();
    const action: AuthorityAction = { type: 'select-hotbar', slot: Number.MAX_SAFE_INTEGER };
    const receipt = await runtime.executeTransaction(identity(runtime, 0), () => runtime.performAction(action));
    expect(projectActionReceiptReference(action, receipt, identity(runtime, 0))).toMatchObject({
      action: { type: 'select-hotbar', slot: Number.MAX_SAFE_INTEGER },
    });
    expect(() =>
      projectActionReceiptReference(
        { type: 'place', position: Array(3) } as unknown as AuthorityAction,
        receipt,
        identity(runtime, 0),
      ),
    ).toThrow(/position/);
  });
});

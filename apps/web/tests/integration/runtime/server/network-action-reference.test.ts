import { testCorePlatform } from '../../../../../../packages/stdlib/tests/support/core-platform';
import { describe, expect, it } from 'vitest';
import { AuthorityRuntime } from '../../../../../../packages/stdlib/src/server/authority/authority-runtime';
import { projectActionReceiptReference } from '../../../../../../packages/stdlib/src/server/protocol/network-action-reference';
import { copyAuthorityActionReference } from '../../../../../../packages/stdlib/src/server/protocol/network-action-reference-copy';
import type { AuthorityAction } from '../../../../../../packages/stdlib/src/server/protocol/authority-worker-protocol';
import {
  assembleOverworldPacks,
  createGameplayActorAuthority,
  createGameplaySystemAuthority,
} from '@seedlands/stdlib/host';
import { pack } from '../../../../../../playbooks/classic/src/pack';

const makeRuntime = () =>
  AuthorityRuntime.create({
    platform: testCorePlatform,
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
const makeComposedRuntime = () => {
  const composition = assembleOverworldPacks([
    {
      ...pack,
      integrity: {
        algorithm: 'sha256' as const,
        manifestDigest: 'a'.repeat(64),
        entryDigest: 'b'.repeat(64),
        resources: [],
      },
    },
  ]);
  return AuthorityRuntime.create({
    platform: testCorePlatform,
    epoch: 'action-reference-test',
    seedText: 'action-reference-world',
    initialWorldTime: 8,
    startTimeMs: 0,
    initialPlayerBodyPosition: [0.5, 33, 0.5],
    composition,
    moduleActorAuthority: createGameplayActorAuthority(composition.resources, { playerAlias: 'human' }),
    moduleSystemAuthority: createGameplaySystemAuthority(composition),
  });
};

describe('公开动作回执参考投影', () => {
  it('replays one inventory pointer receipt without applying the owned cursor twice', async () => {
    const runtime = await makeComposedRuntime();
    runtime.server.giveItem(runtime.playerId, { itemId: 'plank', count: 9 });
    const inventory = runtime.server.getInventoryPointerView(runtime.playerId);
    const action: AuthorityAction = {
      type: 'inventory-pointer',
      actor: inventory.actor,
      expectedInventoryRevision: inventory.revision,
      command: { kind: 'click', slot: { kind: 'inventory', slot: 0 }, button: 2 },
    };
    const id = identity(runtime, 0);
    const first = await runtime.executeTransaction(id, () => runtime.performAction(action));
    const repeated = await runtime.executeTransaction(id, () => {
      throw new Error('inventory pointer replay must not execute');
    });
    expect(repeated).toBe(first);
    expect(runtime.server.getInventoryPointerView(runtime.playerId)).toMatchObject({
      revision: inventory.revision + 1,
      cursor: { stack: { itemId: 'plank', count: 5 } },
    });
    expect(runtime.server.getInventory(runtime.playerId).slots[0]).toEqual({ itemId: 'plank', count: 4 });
  });

  it('projects a real empty-slot pointer rejection as a bounded public failure', async () => {
    const runtime = await makeComposedRuntime();
    const inventory = runtime.server.getInventoryPointerView(runtime.playerId);
    const action: AuthorityAction = {
      type: 'inventory-pointer',
      actor: inventory.actor,
      expectedInventoryRevision: inventory.revision,
      command: { kind: 'click', slot: { kind: 'inventory', slot: 0 }, button: 0 },
    };
    const receipt = await runtime.executeTransaction(identity(runtime, 0), () => runtime.performAction(action));
    if (receipt.status !== 'executed') throw new Error('fixture transaction was not executed');
    expect(receipt).toMatchObject({
      status: 'executed',
      result: { result: { success: false, reason: 'empty-source-slot' } },
    });
    const projected = projectActionReceiptReference(action, receipt, identity(runtime, 0));
    expect(projected).toMatchObject({
      status: 'executed',
      action,
      outcome: { success: false, reason: 'empty-source-slot' },
    });
    if (projected.status !== 'executed') throw new Error('fixture projection was not executed');
    expect(copyAuthorityActionReference(projected.action)).toEqual(action);
    const forged = {
      ...receipt,
      result: { ...receipt.result, result: { success: false, reason: 'private-module-failure' } },
    };
    expect(() => projectActionReceiptReference(action, forged, identity(runtime, 0))).toThrow(/reason/);
  });

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

import { describe, expect, it } from 'vitest';
import { testCorePlatform } from '../support/core-platform';
import { AuthorityRuntime } from '../../packages/game-core/src/server/authority/authority-runtime';
import { projectActionReceiptReference } from '../../packages/game-core/src/server/protocol/network-action-reference';
import { projectGameplayConsumerReference } from '../../packages/game-core/src/server/protocol/network-gameplay-consumer-reference';
import { gameplayFromReference } from '../../apps/web/src/client/authority/remote-authority-projections';
import { projectCombatUi } from '../../apps/web/src/app/ui/combat-ui-projector';

async function fixture() {
  const runtime = await AuthorityRuntime.create({
    platform: testCorePlatform,
    epoch: 'remote-combat',
    seedText: 'remote-combat',
    initialWorldTime: 9,
    startTimeMs: 0,
    initialPlayerBodyPosition: [0.5, 80, 0.5],
  });
  runtime.server.giveItem(runtime.playerId, { itemId: 'wood-sword', count: 1 });
  runtime.server.selectHotbarSlot(runtime.playerId, 0);
  runtime.server.spawnEntity({
    id: 'dummy',
    type: 'creature',
    archetype: 'grazer',
    position: [0.5, 80, -1.5],
    health: 20,
    maxHealth: 20,
  });
  const action = { type: 'attack' as const, targetId: 'dummy' };
  const identity = { epoch: 'remote-combat', issuer: runtime.playerId, stream: 'player-actions', sequence: 0 };
  const receipt = await runtime.executeTransaction(identity, () => runtime.performAction(action));
  return { runtime, action, identity, receipt };
}

describe('main 木剑玩法与远端公开投影集成', () => {
  it('前摇动作回执不要求尚未发生的伤害，并保留动作与输入缓冲状态', async () => {
    const { action, identity, receipt } = await fixture();
    expect(projectActionReceiptReference(action, receipt, identity)).toMatchObject({
      status: 'executed',
      outcome: { success: true, actionId: expect.any(String), buffered: false },
    });
    expect(projectActionReceiptReference(action, receipt, identity)).not.toHaveProperty('outcome.damage');
  });

  it.each(['buffer-full', 'combo-window-closed'])('真实连击拒绝 %s 是业务反馈，不能关闭协议会话', async (reason) => {
    const { action, identity, receipt } = await fixture();
    if (receipt.status !== 'executed') throw new Error('fixture transaction failed');
    const rejected = { ...receipt, result: { ...receipt.result, result: { success: false, reason } } };
    expect(projectActionReceiptReference(action, rejected, identity)).toMatchObject({
      outcome: { success: false, reason },
    });
  });

  it.each([
    { actionId: '', buffered: false },
    { actionId: 'swing', buffered: 'yes' },
    { actionId: 'swing', buffered: false, damage: NaN },
  ])('拒绝损坏的异步攻击字段 %j', async (result) => {
    const { action, identity, receipt } = await fixture();
    if (receipt.status !== 'executed') throw new Error('fixture transaction failed');
    const corrupted = { ...receipt, result: { ...receipt.result, result: { success: true, ...result } } };
    expect(() => projectActionReceiptReference(action, corrupted, identity)).toThrow();
  });

  it('Node 发布的权威战斗阶段抵达 Web HUD，复制后不与接收消息共享可变对象', async () => {
    const { runtime } = await fixture();
    const snapshot = runtime.snapshot();
    const reference = projectGameplayConsumerReference(runtime.view(), {
      epoch: snapshot.epoch,
      snapshotPhysicsTick: snapshot.physicsTick,
      snapshotCommitSequence: snapshot.commitSequence,
      snapshotWorldRevision: snapshot.worldRevision,
    });
    const view = gameplayFromReference(reference);
    expect(view.player.combat).toEqual(reference.player.combat);
    expect(projectCombatUi(view.player.combat)).toMatchObject({ phase: 'windup', label: '蓄力' });
    expect(view.player.combat).not.toBe(reference.player.combat);
    expect(view.player.combat?.active).not.toBe(reference.player.combat?.active);
  });
});

import { describe, expect, it } from 'vitest';
import { projectCombatUi } from '../../../src/app/ui/combat-ui-projector';

describe('权威战斗 HUD', () => {
  it('缺省兼容旧快照，冷却显示只消费服务端剩余时间', () => {
    expect(projectCombatUi(undefined)).toMatchObject({ phase: 'ready', label: '攻击就绪', remainingSeconds: 0 });
    expect(projectCombatUi({ active: null, cooldownRemainingSeconds: 0.39, lastResult: null })).toMatchObject({
      phase: 'cooldown',
      label: '攻击冷却',
      remainingSeconds: 0.4,
      hint: '等待攻击就绪',
    });
  });
  it('前摇不能显示命中，重复投影不推进权威时间，缓冲有可读反馈', () => {
    const state = {
      active: {
        actionId: 'combat-1',
        definitionId: 'wood-sword',
        targetId: 'target',
        comboStep: 0,
        comboLength: 2,
        canBuffer: false,
        phase: 'windup' as const,
        phaseElapsedSeconds: 0.1,
        phaseDurationSeconds: 0.25,
        buffered: false,
      },
      cooldownRemainingSeconds: 0.8,
      lastResult: null,
    };
    expect(projectCombatUi({ ...state, active: { ...state.active, comboStep: 1, phase: 'recovery' } })).toMatchObject({
      hint: '等待攻击就绪',
    });
    const before = structuredClone(state);
    expect(projectCombatUi(state)).toMatchObject({ phase: 'windup', label: '蓄力', progress: 0.4 });
    expect(projectCombatUi(state)).toEqual(projectCombatUi(state));
    expect(state).toEqual(before);
    expect(projectCombatUi({ ...state, active: { ...state.active, phase: 'recovery', buffered: true } })).toMatchObject(
      {
        label: '收招',
        hint: '已衔接下一击',
      },
    );
  });
});

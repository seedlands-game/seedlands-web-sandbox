import type { CombatSnapshot } from '@seedlands/game-core/server/gameplay/combat-runtime';

export type CombatUiProjection = Readonly<{
  phase: 'ready' | 'cooldown' | 'windup' | 'hit' | 'recovery';
  label: string;
  remainingSeconds: number;
  progress: number;
  comboStep: number;
  hint: string;
}>;

/** 只投影权威剩余时间；渲染帧与动画事件不推进战斗时钟。 */
export function projectCombatUi(combat: CombatSnapshot | undefined): CombatUiProjection {
  const active = combat?.active;
  const remaining = Math.max(0, combat?.cooldownRemainingSeconds ?? 0);
  const phase = active?.phase ?? (remaining > 0 ? 'cooldown' : 'ready');
  return {
    phase,
    label: { ready: '攻击就绪', cooldown: '攻击冷却', windup: '蓄力', hit: '挥击', recovery: '收招' }[phase],
    remainingSeconds: Math.ceil(remaining * 10) / 10,
    progress: active
      ? Math.round(
          Math.min(1, Math.max(0, active.phaseElapsedSeconds / Math.max(0.001, active.phaseDurationSeconds))) * 100,
        ) / 100
      : phase === 'ready'
        ? 1
        : 0,
    comboStep: active?.comboStep ?? 0,
    hint: active?.buffered
      ? '已衔接下一击'
      : active?.canBuffer
        ? '现在按左键衔接'
        : active && active.comboStep + 1 < active.comboLength
          ? '等待衔接窗口'
          : phase === 'ready'
            ? '左键攻击'
            : '等待攻击就绪',
  };
}

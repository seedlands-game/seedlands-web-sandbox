import type { CombatSnapshot } from '@seedlands/stdlib/server/gameplay/combat-runtime';

type Pose = Readonly<{ shoulder: number; elbow: number; wrist: number }>;
const rest: Pose = { shoulder: 0, elbow: 0, wrist: 0 };

/** 权威阶段驱动握持动作；仅返回表现关节角，不产生规则事件。 */
export function combatViewmodelPose(active: CombatSnapshot['active']): Pose | null {
  if (!active) return null;
  const raw = active.phaseElapsedSeconds / Math.max(0.001, active.phaseDurationSeconds);
  const t = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0;
  const eased = t * t * (3 - 2 * t);
  const direction = active.comboStep % 2 === 0 ? 1 : -1;
  const raised: Pose = { shoulder: -66, elbow: -56 * direction, wrist: -58 * direction };
  const struck: Pose = { shoulder: 58, elbow: 70 * direction, wrist: 74 * direction };
  const from = active.phase === 'windup' ? rest : active.phase === 'hit' ? raised : struck;
  const to = active.phase === 'windup' ? raised : active.phase === 'hit' ? struck : rest;
  return {
    shoulder: from.shoulder + (to.shoulder - from.shoulder) * eased,
    elbow: from.elbow + (to.elbow - from.elbow) * eased,
    wrist: from.wrist + (to.wrist - from.wrist) * eased,
  };
}

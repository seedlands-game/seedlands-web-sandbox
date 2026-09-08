import { expect, it } from 'vitest';
import { combatViewmodelPose } from '../../apps/web/src/client/presentation/combat-viewmodel-pose';

it('权威阶段形成前摇、挥击、恢复连续动作，第二段反向且不改变输入', () => {
  const active = {
    actionId: 'a',
    definitionId: 'custom',
    targetId: 't',
    comboStep: 0,
    comboLength: 2,
    canBuffer: false,
    phase: 'windup' as const,
    phaseElapsedSeconds: 0,
    phaseDurationSeconds: 0.2,
    buffered: false,
  };
  expect(combatViewmodelPose(null)).toBeNull();
  expect(combatViewmodelPose(active)).toEqual({ shoulder: 0, elbow: 0, wrist: 0 });
  const raised = combatViewmodelPose({ ...active, phaseElapsedSeconds: 0.2 });
  expect(raised).toEqual(combatViewmodelPose({ ...active, phase: 'hit' }));
  const struck = combatViewmodelPose({ ...active, phase: 'hit', phaseElapsedSeconds: 0.2 });
  expect(struck).toEqual(combatViewmodelPose({ ...active, phase: 'recovery' }));
  expect(combatViewmodelPose({ ...active, phase: 'recovery', phaseElapsedSeconds: 0.2 })).toEqual({
    shoulder: 0,
    elbow: 0,
    wrist: 0,
  });
  expect(combatViewmodelPose({ ...active, comboStep: 1, phaseElapsedSeconds: 0.2 })?.wrist).toBe(-raised!.wrist);
  expect(active.phaseElapsedSeconds).toBe(0);
});

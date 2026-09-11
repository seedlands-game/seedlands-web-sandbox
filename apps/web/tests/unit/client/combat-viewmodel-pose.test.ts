import { expect, it } from 'vitest';
import { combatViewmodelPose } from '../../../src/client/presentation/combat-viewmodel-pose';

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
  const reverseRaised = combatViewmodelPose({ ...active, comboStep: 1, phaseElapsedSeconds: 0.2 });
  const reverseStruck = combatViewmodelPose({
    ...active,
    comboStep: 1,
    phase: 'hit',
    phaseElapsedSeconds: 0.2,
  });
  expect(reverseRaised?.elbow).toBe(-raised!.elbow);
  expect(reverseRaised?.wrist).toBe(-raised!.wrist);
  expect(reverseStruck?.elbow).toBe(-struck!.elbow);
  expect(reverseStruck?.wrist).toBe(-struck!.wrist);
  expect(Math.abs(struck!.shoulder - raised!.shoulder)).toBeGreaterThanOrEqual(120);
  expect(active.phaseElapsedSeconds).toBe(0);
});

import { describe, expect, it } from 'vitest';
import { crackSegmentsForStage } from '../../../src/app/gameplay/break-overlay-pattern';

describe('方块破坏裂纹固定拓扑', () => {
  it('十个阶段严格增长，且已经出现的线段永远保持为下一阶段的前缀', () => {
    const stages = Array.from({ length: 10 }, (_unused, stage) => crackSegmentsForStage(stage));
    expect(stages[0].length).toBeGreaterThan(0);
    for (let stage = 0; stage < stages.length - 1; stage += 1) {
      expect(stages[stage + 1].length).toBeGreaterThan(stages[stage].length);
      expect(stages[stage + 1].slice(0, stages[stage].length)).toEqual(stages[stage]);
    }
  });

  it('相同阶段重复生成得到完全相同的坐标和方向', () => {
    expect(crackSegmentsForStage(6)).toEqual(crackSegmentsForStage(6));
  });
});

import { describe, expect, it } from 'vitest';
import { soundForGameplayEvent } from '../../../src/client/audio/gameplay-audio-events';
import { Voxel } from '../../../../../packages/stdlib/src/world/voxel';

describe('权威玩法结果的音频语义', () => {
  it('材质与世界位置保留，水和雪不能对调', () => {
    expect(soundForGameplayEvent({ kind: 'break', voxel: Voxel.Wood, position: [1, 2, 3] })).toMatchObject({
      key: 'break-wood',
      position: [1, 2, 3],
    });
    expect(soundForGameplayEvent({ kind: 'place', voxel: Voxel.Water, position: [0, 0, 0] }).key).toBe('place-water');
    expect(soundForGameplayEvent({ kind: 'break', voxel: Voxel.Snow, position: [0, 0, 0] }).key).toBe('break-snow');
  });
  it('拒绝只产生错误提示，伤害优先于环境操作', () => {
    expect(soundForGameplayEvent({ kind: 'rejected' }).key).toBe('cancel');
    expect(soundForGameplayEvent({ kind: 'eat' }).key).toBe('eat');
    expect(soundForGameplayEvent({ kind: 'pickup' }).key).toBe('pickup');
    expect(soundForGameplayEvent({ kind: 'damage', amount: 2 }).priority).toBeGreaterThan(
      soundForGameplayEvent({ kind: 'craft' }).priority,
    );
  });
});

import { describe, expect, it } from 'vitest';
import { WaterAudioPolicy } from '../../apps/web/src/client/audio/water-audio-policy';

describe('水体音频事件策略', () => {
  it('入水与出水各只产生一次边沿事件', () => {
    const policy = new WaterAudioPolicy();
    expect(policy.sample({ wading: false, swimming: false, cameraSubmerged: false }, 0, 0, false)).toEqual([]);
    expect(policy.sample({ wading: true, swimming: false, cameraSubmerged: false }, 0, 0.1, false)).toEqual([
      'water-enter',
    ]);
    expect(policy.sample({ wading: true, swimming: false, cameraSubmerged: false }, 0, 0.2, false)).toEqual([]);
    expect(policy.sample({ wading: false, swimming: false, cameraSubmerged: false }, 0, 0.3, false)).toEqual([
      'water-exit',
    ]);
  });

  it('涉水与划水按移动距离节流且暂停时清空积累', () => {
    const policy = new WaterAudioPolicy();
    policy.sample({ wading: true, swimming: false, cameraSubmerged: false }, 0, 0, false);
    expect(policy.sample({ wading: true, swimming: false, cameraSubmerged: false }, 0.8, 0.4, false)).toEqual([
      'water-wade',
    ]);
    expect(policy.sample({ wading: true, swimming: false, cameraSubmerged: false }, 0.9, 0.5, false)).toEqual([]);
    policy.sample({ wading: true, swimming: true, cameraSubmerged: true }, 4, 0.6, true);
    expect(policy.sample({ wading: true, swimming: true, cameraSubmerged: true }, 4.1, 0.7, false)).toEqual([]);
    expect(policy.sample({ wading: true, swimming: true, cameraSubmerged: true }, 5.4, 1.2, false)).toEqual([
      'water-swim',
    ]);
  });
});

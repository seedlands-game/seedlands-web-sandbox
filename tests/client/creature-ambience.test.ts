import { describe, expect, it } from 'vitest';
import { CreatureAmbience } from '../../src/client/audio/creature-ambience';

describe('附近生物空间短鸣', () => {
  it('最近声源、启动缓冲与12秒预算，远方和暂停不发声', () => {
    const ambience = new CreatureAmbience();
    const actors = [
      { id: 'far', position: [25, 0, 0] as const },
      { id: 'near', position: [2, 0, 0] as const },
      { id: 'middle', position: [7, 0, 0] as const },
    ];
    expect(ambience.sample(0, [0, 0, 0], actors, false)).toBeNull();
    expect(ambience.sample(6, [0, 0, 0], actors, false)?.id).toBe('near');
    expect(ambience.sample(10, [0, 0, 0], actors, false)).toBeNull();
    expect(ambience.sample(18, [0, 0, 0], [actors[0]], false)).toBeNull();
    expect(ambience.sample(19, [0, 0, 0], actors, true)).toBeNull();
    expect(ambience.sample(20, [0, 0, 0], actors, false)).toBeNull();
    expect(ambience.sample(25, [0, 0, 0], actors, false)?.id).toBe('near');
  });
});

import { describe, expect, it } from 'vitest';
import { CreativeBreakCadence } from '../../../src/app/player/creative-break-cadence';

describe('创造模式破坏节奏', () => {
  it('250ms 后开始重复，之后每 200ms 最多一次', () => {
    const cadence = new CreativeBreakCadence();
    cadence.start();

    expect(cadence.advance(0.249)).toBe(false);
    expect(cadence.advance(0.001)).toBe(true);
    expect(cadence.advance(0.199)).toBe(false);
    expect(cadence.advance(0.001)).toBe(true);
  });

  it('低帧率只发一次且不在下一帧补发积压', () => {
    const cadence = new CreativeBreakCadence();
    cadence.start();

    expect(cadence.advance(0.74)).toBe(true);
    expect(cadence.advance(0.01)).toBe(false);
    expect(cadence.advance(0.19)).toBe(true);
  });

  it('停止后重新开始不继承上一次的按住时间', () => {
    const cadence = new CreativeBreakCadence();
    cadence.start();
    expect(cadence.advance(0.25)).toBe(true);
    cadence.stop();
    cadence.start();

    expect(cadence.advance(0.249)).toBe(false);
  });
});

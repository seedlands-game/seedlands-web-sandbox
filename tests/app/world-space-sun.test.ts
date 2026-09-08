import { describe, expect, it } from 'vitest';
import { celestialDirection } from '../../apps/web/src/app/scene/sky-sun';

describe('world-space sun direction', () => {
  it('is deterministic for fixed time and crosses the horizon', () => {
    const noon = celestialDirection(12);
    expect(noon.toArray()).toEqual(celestialDirection(12).toArray());
    expect(noon.y).toBeCloseTo(1, 6);
    expect(celestialDirection(0).y).toBeCloseTo(-1, 6);
    expect(noon.length()).toBeCloseTo(1, 6);
  });
});

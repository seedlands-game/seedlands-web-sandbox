import { describe, expect, it } from 'vitest';
import { nearestEntityHit } from '../../../src/client/presentation/entity-hit-volume';

describe('production entity hit selection', () => {
  it('selects the nearest entity intersected by the attack ray', () => {
    const far = { id: 'far', position: [0, 0, -2.5] as const, archetype: 'zombie' };
    const near = { id: 'near', position: [0, 0, -2] as const, archetype: 'zombie' };
    expect(nearestEntityHit([far, near], [0, 0.9, 0], [0, 0, -1], 3)).toBe(near);
    expect(nearestEntityHit([far, near], [1, 0.9, 0], [0, 0, -1], 3)).toBeUndefined();
  });
});

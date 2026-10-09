import { describe, expect, it } from 'vitest';
import { freezeCropPolicy } from '../src/server/gameplay/modules/crop-policy';

const policy = {
  soilVoxels: [26],
  emptyAboveVoxels: [0],
  waterVoxels: [8],
  seedItemId: 'wheat-seeds',
  matureDrops: [{ itemId: 'wheat', count: 1 }],
  immatureDrops: [{ itemId: 'wheat-seeds', count: 1 }],
};

describe('crop presentation policy identity', () => {
  it('freezes the optional presentation id without adding it to crop state', () => {
    const frozen = freezeCropPolicy({ ...policy, presentationId: 'seedlands:wheat-crop' });

    expect(Reflect.get(frozen, 'presentationId')).toBe('seedlands:wheat-crop');
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.hasOwn(freezeCropPolicy(policy), 'presentationId')).toBe(false);
  });

  it.each(['', 'Not an id'])('rejects invalid presentation id %j', (presentationId) => {
    expect(() => freezeCropPolicy({ ...policy, presentationId })).toThrow();
  });
});

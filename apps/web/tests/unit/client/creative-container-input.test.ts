import { describe, expect, it, vi } from 'vitest';
import { performSecondaryInteraction } from '../../../src/app/player/secondary-interaction';

const target = {
  voxel: 12,
  position: [1, 2, 3] as [number, number, number],
  adjacent: [1, 2, 2] as [number, number, number],
  distance: 2,
  inRange: true,
};

describe('secondary player interaction precedence', () => {
  it('uses the aimed station before held-item use or placement', () => {
    const calls: string[] = [];
    expect(
      performSecondaryInteraction({
        target,
        bypassTarget: false,
        useTarget: () => (calls.push('target'), true),
        useHeldItem: () => (calls.push('held'), true),
        place: () => calls.push('place'),
        feedback: vi.fn(),
      }),
    ).toBe('target');
    expect(calls).toEqual(['target']);
  });

  it('bypasses the aimed station while Shift is held and places beside it', () => {
    const calls: string[] = [];
    expect(
      performSecondaryInteraction({
        target,
        bypassTarget: true,
        useTarget: () => (calls.push('target'), true),
        useHeldItem: () => (calls.push('held'), false),
        place: (position) => calls.push(`place:${position.join(',')}`),
        feedback: vi.fn(),
      }),
    ).toBe('place');
    expect(calls).toEqual(['held', 'place:1,2,2']);
  });
});

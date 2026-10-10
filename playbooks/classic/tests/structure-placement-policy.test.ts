import { describe, expect, it } from 'vitest';
import { classicWoodenDoorClosedStateForBearing, classicWoodenDoorOrientations } from '../src/structures';

describe('Classic wooden door placement policy', () => {
  it.each(classicWoodenDoorOrientations)('maps trusted %s bearing to its closed state', (bearing) => {
    expect(classicWoodenDoorClosedStateForBearing(bearing)).toBe(`${bearing}-closed`);
  });

  it('rejects untrusted bearings instead of inventing an orientation', () => {
    expect(() => classicWoodenDoorClosedStateForBearing('up' as never)).toThrow(/bearing/i);
  });
});

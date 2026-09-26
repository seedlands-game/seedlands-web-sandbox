import { describe, expect, it } from 'vitest';
import {
  LEGACY_GAMEPLAY_PROVENANCE_UNKNOWN,
  LEGACY_GAMEPLAY_PROVENANCE_UNKNOWN_MESSAGE,
  assertBrowserGameplayProvenance,
  browserGameplayFailureMessage,
} from '../../../src/client/persistence/legacy-gameplay-provenance-error';

describe('Browser legacy Gameplay provenance', () => {
  const snapshot = (version: 1 | 2 | 3) => ({
    version,
    revision: 0,
    gameplayTime: 0,
    entitySequence: 0,
    entities: [],
    players: [],
    ...(version === 1 ? {} : { worldTime: 9, simulation: {} }),
    ...(version === 3
      ? {
          coordinateSchema: { version: 1, units: 'voxel', entityOrigin: 'body-feet-center' },
          physicsSchema: { version: 1, bodyRegistryVersion: 1 },
        }
      : {}),
  });

  it.each([1, 2, 3])('rejects unproven Gameplay V%s with a stable typed code', (version) => {
    expect(() => assertBrowserGameplayProvenance(snapshot(version as 1 | 2 | 3))).toThrow(
      LEGACY_GAMEPLAY_PROVENANCE_UNKNOWN,
    );
  });

  it.each([
    null,
    { version: 2, revision: 0, gameplayTime: 0, entitySequence: 0, entities: [], players: [], worldTime: 9 },
    { ...snapshot(2), simulation: [] },
    { ...snapshot(3), simulation: null },
    { ...snapshot(3), coordinateSchema: { version: 2, units: 'voxel', entityOrigin: 'body-feet-center' } },
    { version: 3 },
    { version: 4 },
    { version: 5 },
    [],
    Object.create(snapshot(3)),
  ])('does not relabel non-legacy or malformed input: %j', (snapshot) => {
    expect(() => assertBrowserGameplayProvenance(snapshot)).not.toThrow();
  });

  it('maps only the exact typed code to the product message', () => {
    expect(browserGameplayFailureMessage(new Error(`${LEGACY_GAMEPLAY_PROVENANCE_UNKNOWN}: missing source`))).toBe(
      LEGACY_GAMEPLAY_PROVENANCE_UNKNOWN_MESSAGE,
    );
    expect(browserGameplayFailureMessage(new Error(`prefix ${LEGACY_GAMEPLAY_PROVENANCE_UNKNOWN}`))).toBe(
      `prefix ${LEGACY_GAMEPLAY_PROVENANCE_UNKNOWN}`,
    );
    expect(browserGameplayFailureMessage(new Error('disk unavailable'))).toBe('disk unavailable');
  });

  it('checks an imported world Gameplay child without classifying V4', () => {
    expect(() => assertBrowserGameplayProvenance({ ...snapshot(3) })).toThrow(LEGACY_GAMEPLAY_PROVENANCE_UNKNOWN);
    expect(() => assertBrowserGameplayProvenance({ version: 4, composition: {} })).not.toThrow();
  });
});

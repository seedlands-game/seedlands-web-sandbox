import { describe, expect, it } from 'vitest';
import {
  createResidentBirthSchema,
  isResidentBirthPackage,
  parseResidentBirthPackage,
  RESIDENT_BIRTH_LIMITS,
} from '../../apps/agent-server/src/resident-birth-codec';
import { validBirth } from '../../apps/agent-server/src/node/resident-host-validation';
import { baselineObservation } from './fixtures';

const birthPayload = () => {
  const character = baselineObservation().character;
  return {
    profile: character.profile,
    agent: 'Observe the current world before choosing an action.',
    soul: 'Respect the world and the people living in it.',
    memory: 'I have just arrived and have no prior experiences in this world.',
    goal: character.behaviorTree.goal,
    definition: character.behaviorTree.definition,
  };
};

describe('resident birth codec', () => {
  it('derives a conservative provider schema from the exact UTF-8 limits', () => {
    const schema = createResidentBirthSchema('bounded behavior guide');
    expect(RESIDENT_BIRTH_LIMITS.agentSoulSchemaCharacters).toBe(1024);
    expect(schema).toMatchObject({
      properties: {
        agent: { maxLength: 1024, pattern: '\\S' },
        soul: { maxLength: 1024, pattern: '\\S' },
        memory: {
          maxLength: 4000,
          pattern: '\\S',
          description: expect.stringContaining('no prior experiences'),
        },
        goal: { properties: { description: { maxLength: 2000, pattern: '\\S' } } },
        definition: { description: 'bounded behavior guide' },
      },
    });
  });

  it('accepts exactly 4 KiB and rejects the next Unicode code point with metadata but no document text', () => {
    const exact = '😀'.repeat(1024);
    const accepted = parseResidentBirthPackage({ ...birthPayload(), agent: exact, soul: exact }, 'birth-exact');
    expect(isResidentBirthPackage(accepted)).toBe(true);

    const oversized = '😀'.repeat(1025);
    let failure: unknown;
    try {
      parseResidentBirthPackage({ ...birthPayload(), soul: oversized }, 'birth-oversized');
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      name: 'ResidentBirthValidationError',
      field: 'soul',
      reason: 'utf8-bytes',
      actualBytes: 4100,
      maximumBytes: 4096,
    });
    expect((failure as Error).message).not.toContain('😀');
    expect(isResidentBirthPackage({ birthId: 'birth-oversized', ...birthPayload(), soul: oversized })).toBe(false);
  });

  it('rejects the original host object when unknown top-level data pushes it past the package limit', () => {
    const smallExtra = { birthId: 'birth-with-small-extra', ...birthPayload(), unrecognized: 'x' };
    expect(Buffer.byteLength(JSON.stringify(smallExtra), 'utf8')).toBeLessThan(RESIDENT_BIRTH_LIMITS.packageBytes);
    expect(isResidentBirthPackage(smallExtra)).toBe(false);
    expect(validBirth(smallExtra)).toBe(false);

    const value = {
      birthId: 'birth-with-extra',
      ...birthPayload(),
      unrecognized: 'x'.repeat(64 * 1024),
    };
    expect(Buffer.byteLength(JSON.stringify(value), 'utf8')).toBeGreaterThan(RESIDENT_BIRTH_LIMITS.packageBytes);
    expect(isResidentBirthPackage(value)).toBe(false);
    expect(validBirth(value)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { BEHAVIOR_MAX_OPERATION_ID_LENGTH } from '@seedlands/stdlib/runtime/behavior-control-protocol';
import { CHARACTER_OBSERVATION_MAX_EVENTS } from '@seedlands/stdlib/runtime/character-control-protocol';
import { CONTROLLER_FRAME_MAX_BYTES } from '@seedlands/cognition-protocol';
import { parseControllerClientMessage } from '../src/wire-validation';
import { validCapabilities } from '../src/node/resident-host-validation';
import { binding, event, maximumIntendedChineseObservation, observation, waitCapabilities } from './fixtures';

describe('controller wire validation', () => {
  it('accepts the current world capability identity and rejects legacy or mismatched descriptors', () => {
    const [wait] = waitCapabilities();
    expect(wait).toBeDefined();
    expect(validCapabilities([wait])).toBe(true);
    expect(validCapabilities([{ kind: 'skill', name: 'wait', description: 'legacy', arguments: {} }])).toBe(false);
    expect(validCapabilities([{ ...wait!, requiredOperations: undefined }])).toBe(false);
    expect(
      validCapabilities([
        { ...wait!, requiredOperations: [{ operationId: 'seedlands:unknown', authorization: 'actor' }] },
      ]),
    ).toBe(false);
    expect(validCapabilities([{ ...wait!, name: 'legacy-alias' }])).toBe(false);
    expect(validCapabilities([{ ...wait!, provider: { ...wait!.provider, moduleId: '' } }])).toBe(false);
    expect(validCapabilities([wait!, { ...wait!, version: '2.0.0' }])).toBe(false);
    const operationId = `example:${'x'.repeat(BEHAVIOR_MAX_OPERATION_ID_LENGTH - 'example:'.length)}`;
    expect(validCapabilities([{ ...wait!, requiredOperations: [{ operationId, authorization: 'self' }] }])).toBe(true);
    expect(
      validCapabilities([
        { ...wait!, requiredOperations: [{ operationId: `${operationId}x`, authorization: 'self' }] },
      ]),
    ).toBe(false);
  });

  it('accepts the maximum intended Chinese observation under the shared UTF-8 frame budget', () => {
    const message = {
      kind: 'observe',
      protocolVersion: 1,
      binding: binding(),
      sequence: 1,
      observation: maximumIntendedChineseObservation(),
    };
    expect(Buffer.byteLength(JSON.stringify(message), 'utf8')).toBeLessThan(CONTROLLER_FRAME_MAX_BYTES);
    expect(parseControllerClientMessage(message)).not.toBeNull();
  });

  it('accepts Authority historical, moving-head, final, and empty pages', () => {
    const frame = (events: ReturnType<typeof event>[], cursor: number, eventCursor: number) => ({
      kind: 'observe',
      protocolVersion: 1,
      binding: binding(),
      sequence: 1,
      observation: observation({
        character: { ...observation().character, eventCursor },
        events,
        cursor,
      }),
    });
    expect(
      parseControllerClientMessage(
        frame(
          Array.from({ length: 32 }, (_, index) => event(index + 1)),
          32,
          80,
        ),
      ),
    ).not.toBeNull();
    expect(
      parseControllerClientMessage(
        frame(
          Array.from({ length: 32 }, (_, index) => event(index + 33)),
          64,
          81,
        ),
      ),
    ).not.toBeNull();
    expect(
      parseControllerClientMessage(
        frame(
          Array.from({ length: 17 }, (_, index) => event(index + 65)),
          81,
          81,
        ),
      ),
    ).not.toBeNull();
    expect(parseControllerClientMessage(frame([], 81, 81))).not.toBeNull();
    expect(
      parseControllerClientMessage(
        frame(
          Array.from({ length: 32 }, (_, index) => event(index + 73)),
          104,
          200,
        ),
      ),
    ).not.toBeNull();
  });

  const invalidPages: ReadonlyArray<readonly [string, number, ReturnType<typeof event>[], number]> = [
    ['gapped full page', 104, [...Array.from({ length: 31 }, (_, index) => event(index + 1)), event(104)], 104],
    ['zero event cursor', 0, [event(0)], 0],
    ['missing head', undefined as unknown as number, [event(1)], 1],
    ['negative head', -1, [event(1)], 1],
    ['unsafe head', Number.MAX_VALUE, [event(1)], 1],
    ['page beyond head', 1, [event(2)], 2],
    ['duplicate event cursor', 1, [event(1), event(1)], 1],
    ['last event differs from page cursor', 80, Array.from({ length: 32 }, (_, index) => event(index + 1)), 31],
    ['short page stops before head', 80, Array.from({ length: 16 }, (_, index) => event(index + 1)), 16],
    ['event outside retained window', 200, Array.from({ length: 32 }, (_, index) => event(index + 1)), 32],
    ['empty page differs from head', 81, [], 80],
  ];

  it.each(invalidPages)('rejects an inconsistent event page: %s', (_name, eventCursor, events, cursor) => {
    expect(
      parseControllerClientMessage({
        kind: 'observe',
        protocolVersion: 1,
        binding: binding(),
        sequence: 1,
        observation: observation({
          character: { ...observation().character, eventCursor },
          events,
          cursor,
        }),
      }),
    ).toBeNull();
  });

  it('rejects excess events, unknown fields, and binding mismatches', () => {
    const base = {
      kind: 'observe',
      protocolVersion: 1,
      binding: binding(),
      sequence: 1,
      observation: observation(),
    };
    expect(
      parseControllerClientMessage({
        ...base,
        observation: observation({
          events: Array.from({ length: CHARACTER_OBSERVATION_MAX_EVENTS + 1 }, (_, index) => event(index + 1)),
        }),
      }),
    ).toBeNull();
    expect(parseControllerClientMessage({ ...base, arbitraryPatch: {} })).toBeNull();
    expect(
      parseControllerClientMessage({
        ...base,
        observation: observation({ character: { ...observation().character, entityId: 'other' } }),
      }),
    ).toBeNull();
    expect(
      parseControllerClientMessage({
        ...base,
        observation: observation({
          character: { ...observation().character, lifecycle: 'ghost' as 'active' },
        }),
      }),
    ).toBeNull();
  });

  it('accepts a deceased terminal projection after its policy revision invalidates the old binding', () => {
    const message = {
      kind: 'observe',
      protocolVersion: 1,
      binding: binding(),
      sequence: 1,
      observation: observation({
        character: {
          ...observation().character,
          lifecycle: 'deceased' as const,
          policyRevision: binding().policyRevision + 1,
        },
      }),
    };
    expect(parseControllerClientMessage(message)).not.toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import {
  CHARACTER_OBSERVATION_MAX_EVENTS,
  CONTROLLER_FRAME_MAX_BYTES,
} from '@seedlands/game-core/runtime/character-control-protocol';
import { parseControllerClientMessage } from '../../apps/agent-server/src/wire-validation';
import { binding, event, observation } from './fixtures';

describe('controller wire validation', () => {
  it('accepts the maximum intended Chinese observation under the shared UTF-8 frame budget', () => {
    const events = Array.from({ length: CHARACTER_OBSERVATION_MAX_EVENTS }, (_, index) => ({
      ...event(index + 1),
      text: '界'.repeat(280),
    }));
    const message = {
      kind: 'observe',
      protocolVersion: 1,
      binding: binding(),
      sequence: 1,
      observation: observation({
        character: {
          ...observation().character,
          memory: { revision: 4, throughCursor: 0, summary: '忆'.repeat(16_000) },
        },
        events,
        cursor: CHARACTER_OBSERVATION_MAX_EVENTS,
      }),
    };
    expect(Buffer.byteLength(JSON.stringify(message), 'utf8')).toBeLessThan(CONTROLLER_FRAME_MAX_BYTES);
    expect(parseControllerClientMessage(message)).not.toBeNull();
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

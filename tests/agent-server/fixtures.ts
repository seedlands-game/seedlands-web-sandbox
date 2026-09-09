import type {
  CharacterEvent,
  CharacterObservation,
  ControlBinding,
} from '@seedlands/game-core/runtime/character-control-protocol';

export const binding = (overrides: Partial<ControlBinding> = {}): ControlBinding => ({
  sessionId: 'session-1',
  worldId: 'world-1',
  epoch: 'epoch-1',
  entityId: 'npc-1',
  incarnation: 'incarnation-1',
  policyRevision: 3,
  ...overrides,
});

export const event = (cursor: number, type: CharacterEvent['type'] = 'dialogue-heard'): CharacterEvent => ({
  cursor,
  at: cursor * 1000,
  type,
  text: type === 'dialogue-heard' ? 'Can you find food?' : undefined,
});

export const observation = (overrides: Partial<CharacterObservation> = {}): CharacterObservation => ({
  character: {
    lifecycle: 'active',
    entityId: 'npc-1',
    incarnation: 'incarnation-1',
    revision: 8,
    policyRevision: 3,
    profile: { name: 'Lin', personality: 'Careful and kind', riskTolerance: 0.25 },
    currentGoal: {
      revision: 2,
      requestId: 'old-goal',
      goal: { kind: 'idle' },
      status: 'active',
    },
    behavior: 'idle',
    hunger: 0.7,
    inventory: [{ itemId: 'berry', count: 1 }],
    memory: { revision: 4, throughCursor: 0, summary: 'Met the player.' },
    eventCursor: 1,
  },
  self: { position: [1, 2, 3], health: 10 },
  visibleEntities: [
    {
      target: { kind: 'entity', ref: 'drop-1', revision: 5 },
      type: 'item-drop',
      distance: 2,
      position: [2, 2, 3],
      stack: { itemId: 'berry', count: 2 },
    },
  ],
  visiblePois: [],
  events: [event(1)],
  cursor: 1,
  ...overrides,
});

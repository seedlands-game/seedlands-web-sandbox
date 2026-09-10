import {
  CHARACTER_OBSERVATION_MAX_EVENTS,
  createLifeBehavior,
} from '@seedlands/game-core/runtime/character-control-protocol';
import type { BehaviorCapability } from '@seedlands/game-core/runtime/behavior-control-protocol';
import { BEHAVIOR_REGISTRY_CAPABILITY, type BehaviorCapabilityRegistry } from '@seedlands/game-core/mod-api';
import { assembleOverworldPacks } from '@seedlands/game-core/server/composition/host-api';
import { pack as overworld } from '../../packages/game-core/src/server/gameplay/playbooks/overworld/pack';
import type {
  CharacterEvent,
  CharacterObservation,
  ControlBinding,
} from '@seedlands/game-core/runtime/character-control-protocol';

export const binding = (overrides: Partial<ControlBinding> = {}): ControlBinding => {
  const value = {
    sessionId: 'session-1',
    worldId: 'world-1',
    epoch: 'epoch-1',
    entityId: 'npc-1',
    incarnation: 'incarnation-1',
    policyRevision: 3,
    ...overrides,
  };
  return {
    ...value,
    actor: overrides.actor ?? { entityId: value.entityId, epoch: 1, lifetime: 1 },
  };
};

const behaviorComposition = assembleOverworldPacks([
  {
    ...overworld,
    integrity: {
      algorithm: 'sha256',
      manifestDigest: 'a'.repeat(64),
      entryDigest: 'b'.repeat(64),
      resources: [],
    },
  },
]);
export const behaviorCatalog = behaviorComposition
  .capability<BehaviorCapabilityRegistry>(BEHAVIOR_REGISTRY_CAPABILITY)
  .catalog();

export const waitCapabilities = (): readonly BehaviorCapability[] =>
  behaviorCatalog.filter((capability) => capability.id === 'wait');

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
    behaviorTree: {
      revision: 1,
      ...createLifeBehavior({ homePosition: [1, 2, 3], patrolPositions: [[2, 2, 3]] }),
      runtime: { cycle: 1, activeNodeIds: [], skills: [], monitors: [], milestones: [] },
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
  worldTime: 12,
  eventCoverage: { requestedAfter: 0, through: 1, returnedThrough: 1, hasMore: false },
  ...overrides,
});

export const baselineObservation = (): CharacterObservation => {
  const current = observation();
  return observation({
    character: { ...current.character, eventCursor: 0 },
    events: [],
    cursor: 0,
  });
};

export const maximumIntendedChineseObservation = (): CharacterObservation => {
  const events = Array.from({ length: CHARACTER_OBSERVATION_MAX_EVENTS }, (_, index) => ({
    ...event(index + 1),
    text: '界'.repeat(280),
  }));
  const current = observation();
  return observation({
    character: {
      ...current.character,
      eventCursor: events.length,
      memory: { revision: 4, throughCursor: 0, summary: '忆'.repeat(16_000) },
    },
    events,
    cursor: events.length,
    eventCoverage: {
      requestedAfter: 0,
      through: events.length,
      returnedThrough: events.length,
      hasMore: false,
    },
  });
};

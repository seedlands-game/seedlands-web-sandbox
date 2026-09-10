import { createLifeBehavior, type CharacterBehaviorInput } from '../../runtime/character-control-protocol';
import type { BehaviorDefinition } from '../../runtime/behavior-control-protocol';
import type {
  CharacterBehaviorRecord,
  CharacterPositionTuple,
  CharacterRuntimeOptions,
} from './character-runtime-types';
import {
  behaviorConditionConsumers,
  behaviorConditionContainsDialogue,
  validateBehavior,
} from './character-behavior-definition';

const cloneJson = <Value>(value: Value): Value => JSON.parse(JSON.stringify(value)) as Value;

export function createBehaviorRecord(
  goal: CharacterBehaviorRecord['goal'],
  definition: BehaviorDefinition,
  registry: CharacterRuntimeOptions['capabilities'],
  revision = 1,
  dialogueCursor = 0,
): CharacterBehaviorRecord {
  validateBehavior(goal, definition, registry);
  return {
    revision,
    goal: cloneJson(goal),
    definition: cloneJson(definition),
    cycle: 0,
    activationSequence: 0,
    skills: [],
    monitors: behaviorConditionConsumers(definition)
      .filter((entry) => behaviorConditionContainsDialogue(entry.condition))
      .map((entry) => ({ nodeId: entry.id, matched: false, episode: 0, version: dialogueCursor })),
  };
}

export const characterBehaviorPolicy = (
  home: CharacterPositionTuple,
  behavior?: CharacterBehaviorInput,
): CharacterBehaviorInput =>
  behavior ??
  createLifeBehavior({
    homePosition: home,
    patrolPositions: [
      [home[0] + 3, home[1], home[2]],
      [home[0], home[1], home[2] + 3],
    ],
  });

export function validateActorBehavior(
  options: Pick<CharacterRuntimeOptions, 'capabilities' | 'domain'>,
  entityId: string,
  definition: BehaviorDefinition,
  candidateKind?: 'npc' | 'creature',
): void {
  options.capabilities.validateDefinitionForActor(definition, (capability) =>
    options.domain.allowsCapability(entityId, capability, candidateKind),
  );
}

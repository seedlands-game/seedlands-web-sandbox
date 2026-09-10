import type {
  CharacterEvent,
  CharacterGoal,
  CharacterGoalState,
  CharacterProfile,
} from '../../runtime/character-control-protocol';
import type { ActorAction } from './action-runtime';
import type { BehaviorCapabilityRegistry } from '../composition/behavior-capability-registry';
import {
  behaviorActionNodes,
  behaviorActionSignature,
  behaviorConditionConsumers,
  behaviorConditionContainsDialogue,
  validateBehavior,
} from './character-behavior-definition';
import {
  LEGACY_CHARACTER_INVENTORY_CAPACITY,
  CHARACTER_MAX_EVENTS,
  CHARACTER_MAX_MEMORY_TEXT,
  CHARACTER_MAX_PROFILE_TEXT,
  CHARACTER_MAX_TARGETS,
  CHARACTER_THREAT_MEMORY_SECONDS,
  type CharacterPositionTuple,
  type CharacterSnapshotRecord,
  type CharacterComponentStateV1,
} from './character-runtime-types';
import { Inventory } from '../gameplay/inventory';

const eventTypes: readonly CharacterEvent['type'][] = [
  'dialogue-heard',
  'speech',
  'goal-started',
  'goal-succeeded',
  'goal-failed',
  'goal-interrupted',
  'attacked',
  'target-lost',
  'item-picked-up',
  'item-consumed',
  'activity-started',
  'activity-succeeded',
  'activity-failed',
  'activity-interrupted',
  'rejudge-requested',
  'behavior-updated',
  'fallback',
];

export const characterDistance = (left: readonly number[], right: readonly number[]) =>
  Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);

export const characterPosition = (value: readonly number[], label: string): CharacterPositionTuple => {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite))
    throw new TypeError(`${label} is invalid.`);
  return [...value] as CharacterPositionTuple;
};

export const characterText = (value: string, label: string, maximum: number, allowEmpty = false) => {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim()) || value.length > maximum)
    throw new TypeError(`${label} is invalid.`);
  return value;
};

export const cloneCharacterGoal = (goal: CharacterGoal): CharacterGoal =>
  goal.kind === 'move-to'
    ? { kind: goal.kind, position: [...goal.position] as CharacterPositionTuple }
    : goal.kind === 'follow'
      ? { kind: goal.kind, target: { ...goal.target } }
      : { kind: goal.kind };

export const cloneCharacterGoalState = (goal: CharacterGoalState): CharacterGoalState => ({
  ...goal,
  goal: cloneCharacterGoal(goal.goal),
});

export const sameCharacterGoal = (left: CharacterGoal, right: CharacterGoal): boolean => {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'move-to' && right.kind === 'move-to')
    return left.position.every((value, index) => value === right.position[index]);
  if (left.kind === 'follow' && right.kind === 'follow')
    return (
      left.target.kind === right.target.kind &&
      left.target.ref === right.target.ref &&
      left.target.revision === right.target.revision
    );
  return true;
};

export function validateCharacterProfile(profile: CharacterProfile): void {
  if (!profile || typeof profile !== 'object') throw new TypeError('Character profile is invalid.');
  characterText(profile.name, 'Character name', 80);
  characterText(profile.personality, 'Character personality', CHARACTER_MAX_PROFILE_TEXT);
  if (profile.background !== undefined)
    characterText(profile.background, 'Character background', CHARACTER_MAX_PROFILE_TEXT, true);
  if (
    profile.riskTolerance !== undefined &&
    (!Number.isFinite(profile.riskTolerance) || profile.riskTolerance < 0 || profile.riskTolerance > 1)
  )
    throw new TypeError('Character risk tolerance is invalid.');
}

export function validateCharacterGoal(goal: CharacterGoal): void {
  if (!goal || typeof goal !== 'object' || !['idle', 'forage', 'follow', 'return-home', 'move-to'].includes(goal.kind))
    throw new TypeError('Character goal is invalid.');
  if (goal.kind === 'move-to') characterPosition(goal.position, 'Character move target');
  if (
    goal.kind === 'follow' &&
    (!goal.target ||
      goal.target.kind !== 'entity' ||
      typeof goal.target.ref !== 'string' ||
      !goal.target.ref.trim() ||
      goal.target.ref.length > 256 ||
      !Number.isSafeInteger(goal.target.revision) ||
      goal.target.revision < 1)
  )
    throw new TypeError('Character follow target is invalid.');
}

const validGoalState = (value: CharacterGoalState, maximumRevision: number) => {
  validateCharacterGoal(value.goal);
  if (
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    value.revision > maximumRevision ||
    typeof value.requestId !== 'string' ||
    !value.requestId.trim() ||
    value.requestId.length > 256 ||
    !['active', 'suspended', 'succeeded', 'failed'].includes(value.status) ||
    (value.reason !== undefined && (typeof value.reason !== 'string' || value.reason.length > 256))
  )
    throw new TypeError('Character goal state is invalid.');
};

export function validateCharacterSnapshotRecord(
  value: CharacterSnapshotRecord,
  capabilities?: BehaviorCapabilityRegistry,
): void {
  if (value?.creation !== undefined) {
    if (!value.creation || typeof value.creation !== 'object')
      throw new TypeError('Character creation identity is invalid.');
    characterText(value.creation.id, 'Character creation request id', 160);
    characterText(value.creation.fingerprint, 'Character creation fingerprint', 65536);
  }
  if (
    !value ||
    typeof value.entityId !== 'string' ||
    !value.entityId.trim() ||
    typeof value.incarnation !== 'string' ||
    !value.incarnation.trim() ||
    !['active', 'deceased'].includes(value.lifecycle) ||
    !Number.isSafeInteger(value.revision) ||
    !Number.isSafeInteger(value.revision + 1) ||
    value.revision < 0 ||
    !Number.isSafeInteger(value.policyRevision) ||
    !Number.isSafeInteger(value.policyRevision + 1) ||
    value.policyRevision < 1
  )
    throw new TypeError('Character snapshot identity is invalid.');
  validateCharacterProfile(value.profile);
  validGoalState(value.currentGoal, value.revision);
  if (value.suspendedGoal) validGoalState(value.suspendedGoal, value.revision);
  if (
    !Number.isSafeInteger(value.eventCursor) ||
    !Number.isSafeInteger(value.eventCursor + 1) ||
    value.eventCursor < 0 ||
    !Array.isArray(value.events) ||
    value.events.length > CHARACTER_MAX_EVENTS ||
    (value.eventCursor > 0 && value.events.length === 0) ||
    (value.inventory !== undefined &&
      (!Array.isArray(value.inventory) || value.inventory.length !== LEGACY_CHARACTER_INVENTORY_CAPACITY)) ||
    !Array.isArray(value.targets) ||
    value.targets.length > CHARACTER_MAX_TARGETS ||
    !Array.isArray(value.requestIds) ||
    value.requestIds.length > 64
  )
    throw new TypeError('Character snapshot state is invalid.');
  characterPosition(value.homePosition, 'Character home position');
  characterPosition(value.lastPosition, 'Character last position');
  if (value.inventory) new Inventory(LEGACY_CHARACTER_INVENTORY_CAPACITY, value.inventory);
  if (
    !value.memory ||
    !Number.isSafeInteger(value.memory.revision) ||
    !Number.isSafeInteger(value.memory.revision + 1) ||
    value.memory.revision < 0 ||
    !Number.isSafeInteger(value.memory.throughCursor) ||
    value.memory.throughCursor < 0 ||
    value.memory.throughCursor > value.eventCursor
  )
    throw new TypeError('Character snapshot memory is invalid.');
  characterText(value.memory.summary, 'Character memory summary', CHARACTER_MAX_MEMORY_TEXT, true);
  if (value.lastSpeech !== undefined) characterText(value.lastSpeech, 'Character speech', 280);
  if (value.behaviorTree) {
    if (capabilities) validateBehavior(value.behaviorTree.goal, value.behaviorTree.definition, capabilities);
    const threat = value.behaviorTree.recentThreat;
    if (threat !== undefined) {
      if (
        !threat ||
        !Number.isFinite(threat.secondsRemaining) ||
        threat.secondsRemaining <= 0 ||
        threat.secondsRemaining > CHARACTER_THREAT_MEMORY_SECONDS
      )
        throw new TypeError('Character threat memory is invalid.');
      characterPosition(threat.position, 'Character threat memory position');
    }
    const actionNodes = new Map(
      behaviorActionNodes(value.behaviorTree.definition).map((node) => [
        node.id,
        { node, signature: behaviorActionSignature(node) },
      ]),
    );
    if (
      !Number.isSafeInteger(value.behaviorTree.revision) ||
      value.behaviorTree.revision < 1 ||
      !Number.isSafeInteger(value.behaviorTree.cycle) ||
      value.behaviorTree.cycle < 0 ||
      !Number.isSafeInteger(value.behaviorTree.activationSequence) ||
      value.behaviorTree.activationSequence < 0 ||
      !Array.isArray(value.behaviorTree.skills) ||
      value.behaviorTree.skills.length > 64 ||
      !Array.isArray(value.behaviorTree.monitors) ||
      value.behaviorTree.monitors.length > 128
    )
      throw new TypeError('Character behavior snapshot is invalid.');
    const nodes = new Set<string>();
    for (const skill of value.behaviorTree.skills) {
      if (skill.searchOrigin !== undefined) characterPosition(skill.searchOrigin, 'Character search origin');
      const expected = actionNodes.get(skill.nodeId);
      if (
        !skill.nodeId?.trim() ||
        nodes.has(skill.nodeId) ||
        !skill.skill?.trim() ||
        !skill.signature?.trim() ||
        !expected ||
        expected.node.skill !== skill.skill ||
        expected.signature !== skill.signature ||
        !Number.isSafeInteger(skill.activation) ||
        skill.activation < 1 ||
        skill.activation > value.behaviorTree.activationSequence ||
        !['running', 'succeeded', 'failed', 'interrupted'].includes(skill.status) ||
        !Number.isFinite(skill.elapsedSeconds) ||
        skill.elapsedSeconds < 0 ||
        !Number.isSafeInteger(skill.replanCount) ||
        skill.replanCount < 0 ||
        !Number.isSafeInteger(skill.count) ||
        skill.count < 0 ||
        (skill.providerId !== undefined && (typeof skill.providerId !== 'string' || !skill.providerId.trim())) ||
        (skill.providerModuleId !== undefined &&
          (typeof skill.providerModuleId !== 'string' || !skill.providerModuleId.trim())) ||
        (skill.providerVersion !== undefined &&
          (typeof skill.providerVersion !== 'string' || !skill.providerVersion.trim())) ||
        (skill.stateVersion !== undefined && (typeof skill.stateVersion !== 'string' || !skill.stateVersion.trim())) ||
        (skill.targetPosition !== undefined &&
          (!Array.isArray(skill.targetPosition) ||
            skill.targetPosition.length !== 3 ||
            !skill.targetPosition.every(Number.isFinite)))
      )
        throw new TypeError('Character behavior execution snapshot is invalid.');
      if (expected.node.skill === 'follow' && skill.targetEntityId !== undefined) {
        const targetRef = expected.node.args?.targetRef;
        const binding =
          typeof targetRef === 'string'
            ? value.targets.find((target) => target.kind === 'entity' && target.ref === targetRef)
            : undefined;
        if (!binding || binding.targetId !== skill.targetEntityId)
          throw new TypeError('Character behavior follow execution target is inconsistent.');
      }
      if (skill.providerState !== undefined) {
        const encoded = JSON.stringify(skill.providerState);
        if (encoded === undefined || encoded.length > 16_000)
          throw new TypeError('Character behavior provider state is invalid.');
      }
      if (
        capabilities &&
        skill.providerId !== undefined &&
        skill.providerModuleId !== undefined &&
        skill.providerVersion !== undefined &&
        skill.stateVersion !== undefined &&
        skill.providerState !== undefined
      )
        capabilities.assertRestorable({
          capabilityId: skill.providerId,
          provider: { moduleId: skill.providerModuleId, version: skill.providerVersion },
          state: { version: skill.stateVersion, value: skill.providerState },
        });
      nodes.add(skill.nodeId);
    }
    const conditionConsumers = new Map(
      behaviorConditionConsumers(value.behaviorTree.definition)
        .filter((entry) => entry.monitor || behaviorConditionContainsDialogue(entry.condition))
        .map((entry) => [entry.id, entry.condition]),
    );
    const monitorIds = new Set<string>();
    for (const monitor of value.behaviorTree.monitors) {
      const condition = conditionConsumers.get(monitor.nodeId);
      const hasDialogue = condition ? behaviorConditionContainsDialogue(condition) : false;
      if (
        !monitor.nodeId?.trim() ||
        monitorIds.has(monitor.nodeId) ||
        !condition ||
        typeof monitor.matched !== 'boolean' ||
        !Number.isSafeInteger(monitor.episode) ||
        monitor.episode < 0 ||
        (monitor.version !== undefined &&
          (!Number.isSafeInteger(monitor.version) || monitor.version < 0 || monitor.version > value.eventCursor)) ||
        (hasDialogue && monitor.version === undefined)
      )
        throw new TypeError('Character behavior monitor snapshot is invalid.');
      monitorIds.add(monitor.nodeId);
    }
  }

  let previousCursor = value.eventCursor - value.events.length;
  if (previousCursor < 0) throw new TypeError('Character snapshot event is invalid.');
  for (const event of value.events) {
    if (
      !Number.isSafeInteger(event.cursor) ||
      event.cursor !== previousCursor + 1 ||
      event.cursor > value.eventCursor ||
      !Number.isFinite(event.at) ||
      event.at < 0 ||
      !eventTypes.includes(event.type) ||
      (event.text !== undefined && (typeof event.text !== 'string' || event.text.length > 500)) ||
      (event.reason !== undefined && (typeof event.reason !== 'string' || event.reason.length > 256))
    )
      throw new TypeError('Character snapshot event is invalid.');
    if (event.target)
      if (
        !['entity', 'poi'].includes(event.target.kind) ||
        !event.target.ref.trim() ||
        !Number.isSafeInteger(event.target.revision) ||
        event.target.revision < 1
      )
        throw new TypeError('Character snapshot event target is invalid.');
    if (
      (event.nodeId !== undefined && (typeof event.nodeId !== 'string' || !event.nodeId.trim())) ||
      (event.actionId !== undefined && (typeof event.actionId !== 'string' || !event.actionId.trim())) ||
      (event.episode !== undefined && (!Number.isSafeInteger(event.episode) || event.episode < 0)) ||
      (event.count !== undefined && (!Number.isSafeInteger(event.count) || event.count < 0)) ||
      (event.hunger !== undefined && (!Number.isFinite(event.hunger) || event.hunger < 0 || event.hunger > 100)) ||
      (event.position !== undefined &&
        (!Array.isArray(event.position) || event.position.length !== 3 || !event.position.every(Number.isFinite)))
    )
      throw new TypeError('Character snapshot activity event is invalid.');
    previousCursor = event.cursor;
  }
  const refs = new Set<string>();
  const resources = new Set<string>();
  let greatestTargetSequence = 0;
  for (const target of value.targets) {
    const resource = `${target.kind}:${target.targetId}`;
    const refMatch = /^target-([1-9]\d*)$/.exec(target.ref);
    const refSequence = refMatch ? Number(refMatch[1]) : Number.NaN;
    if (
      !['entity', 'poi'].includes(target.kind) ||
      !Number.isSafeInteger(refSequence) ||
      !target.targetId?.trim() ||
      !Number.isSafeInteger(target.revision) ||
      target.revision < 1 ||
      refs.has(target.ref) ||
      resources.has(resource)
    )
      throw new TypeError('Character snapshot target is invalid or duplicated.');
    refs.add(target.ref);
    resources.add(resource);
    greatestTargetSequence = Math.max(greatestTargetSequence, refSequence);
  }
  if (
    !Number.isSafeInteger(value.targetSequence) ||
    !Number.isSafeInteger(value.targetSequence + 1) ||
    value.targetSequence !== greatestTargetSequence
  )
    throw new TypeError('Character snapshot target sequence is invalid.');
  const requestIds = new Set<string>();
  for (const requestId of value.requestIds) {
    if (typeof requestId !== 'string' || !requestId.trim() || requestId.length > 256 || requestIds.has(requestId))
      throw new TypeError('Character snapshot request id is invalid or duplicated.');
    requestIds.add(requestId);
  }
  if (
    (value.hunger !== undefined && (!Number.isFinite(value.hunger) || value.hunger < 0 || value.hunger > 100)) ||
    typeof value.lastBehavior !== 'string' ||
    !value.lastBehavior.trim() ||
    !Number.isFinite(value.stalledSeconds) ||
    value.stalledSeconds < 0 ||
    !Number.isFinite(value.refreshSeconds) ||
    value.refreshSeconds < 0 ||
    !Number.isFinite(value.dangerSecondsRemaining) ||
    value.dangerSecondsRemaining < 0 ||
    (value.executionTargetId !== undefined && !value.executionTargetId.trim()) ||
    (value.actionId !== undefined && !value.actionId.trim()) ||
    (value.lastThreatEntityId !== undefined && !value.lastThreatEntityId.trim())
  )
    throw new TypeError('Character snapshot execution state is invalid.');
  if (value.lifecycle === 'deceased' && (value.actionId || value.suspendedGoal || value.inventory?.some(Boolean)))
    throw new TypeError('Deceased character snapshot retains active execution state.');
}

export function validateCharacterComponentState(
  raw: unknown,
  capabilities?: BehaviorCapabilityRegistry,
): CharacterComponentStateV1 {
  const value = JSON.parse(JSON.stringify(raw)) as CharacterComponentStateV1;
  if (value?.version !== 1 || value.lifecycle !== 'active' || !value.behaviorTree)
    throw new TypeError('Character behavior component is invalid.');
  if ('inventory' in value || 'hunger' in value)
    throw new TypeError('Character body state cannot be stored in the behavior component.');
  validateCharacterSnapshotRecord(value, capabilities);
  return value;
}

export const cloneCharacterComponentState = (value: CharacterComponentStateV1): CharacterComponentStateV1 =>
  validateCharacterComponentState(value);

const samePosition = (left: readonly number[] | undefined, right: readonly number[]) =>
  Boolean(left && left.length === right.length && left.every((coordinate, index) => coordinate === right[index]));

const validateFollowExecutionLink = (value: CharacterSnapshotRecord, goalState: CharacterGoalState) => {
  const goal = goalState.goal;
  if (goal.kind !== 'follow' || !['active', 'suspended'].includes(goalState.status)) return;
  const binding = value.targets.find((target) => target.ref === goal.target.ref);
  if (
    !value.executionTargetId ||
    !binding ||
    binding.kind !== 'entity' ||
    binding.revision !== goal.target.revision ||
    binding.targetId !== value.executionTargetId
  )
    throw new TypeError('Character snapshot follow target is inconsistent.');
};

export function validateCharacterActionLink(value: CharacterSnapshotRecord, action: ActorAction | null): void {
  validateFollowExecutionLink(value, value.currentGoal);
  if (value.suspendedGoal) validateFollowExecutionLink(value, value.suspendedGoal);
  if (!value.actionId) return;
  const goal = value.currentGoal.goal;
  if (
    !action ||
    action.id !== value.actionId ||
    action.actorId !== value.entityId ||
    action.type !== 'move-to' ||
    value.currentGoal.status !== 'active' ||
    goal.kind === 'idle'
  )
    throw new TypeError('Character snapshot action link is invalid.');
  if (goal.kind === 'move-to' && !samePosition(action.targetPosition, goal.position))
    throw new TypeError('Character snapshot move action is inconsistent.');
  if (goal.kind === 'return-home' && !samePosition(action.targetPosition, value.homePosition))
    throw new TypeError('Character snapshot return action is inconsistent.');
  if (goal.kind === 'forage' || goal.kind === 'follow') {
    if (!value.executionTargetId || action.targetEntityId !== value.executionTargetId)
      throw new TypeError('Character snapshot target action is inconsistent.');
  }
}

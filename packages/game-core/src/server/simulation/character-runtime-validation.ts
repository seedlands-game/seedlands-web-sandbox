import type {
  CharacterEvent,
  CharacterGoal,
  CharacterGoalState,
  CharacterProfile,
} from '../../runtime/character-control-protocol';
import {
  createCharacterInventory,
  CHARACTER_INVENTORY_CAPACITY,
  CHARACTER_MAX_EVENTS,
  CHARACTER_MAX_MEMORY_TEXT,
  CHARACTER_MAX_PROFILE_TEXT,
  type CharacterPositionTuple,
  type CharacterSnapshotRecord,
} from './character-runtime-types';

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
      !['entity', 'poi'].includes(goal.target.kind) ||
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

export function validateCharacterSnapshotRecord(value: CharacterSnapshotRecord): void {
  if (
    !value ||
    typeof value.entityId !== 'string' ||
    !value.entityId.trim() ||
    typeof value.incarnation !== 'string' ||
    !value.incarnation.trim() ||
    !['active', 'deceased'].includes(value.lifecycle) ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    !Number.isSafeInteger(value.policyRevision) ||
    value.policyRevision < 1
  )
    throw new TypeError('Character snapshot identity is invalid.');
  validateCharacterProfile(value.profile);
  validGoalState(value.currentGoal, value.revision);
  if (value.suspendedGoal) validGoalState(value.suspendedGoal, value.revision);
  if (
    !Number.isSafeInteger(value.eventCursor) ||
    value.eventCursor < 0 ||
    !Array.isArray(value.events) ||
    value.events.length > CHARACTER_MAX_EVENTS ||
    !Array.isArray(value.inventory) ||
    value.inventory.length !== CHARACTER_INVENTORY_CAPACITY ||
    !Array.isArray(value.targets) ||
    !Array.isArray(value.requestIds) ||
    value.requestIds.length > 64
  )
    throw new TypeError('Character snapshot state is invalid.');
  characterPosition(value.homePosition, 'Character home position');
  characterPosition(value.lastPosition, 'Character last position');
  createCharacterInventory(value.inventory);
  if (
    !value.memory ||
    !Number.isSafeInteger(value.memory.revision) ||
    value.memory.revision < 0 ||
    !Number.isSafeInteger(value.memory.throughCursor) ||
    value.memory.throughCursor < 0 ||
    value.memory.throughCursor > value.eventCursor
  )
    throw new TypeError('Character snapshot memory is invalid.');
  characterText(value.memory.summary, 'Character memory summary', CHARACTER_MAX_MEMORY_TEXT, true);
  if (value.lastSpeech !== undefined) characterText(value.lastSpeech, 'Character speech', 280);

  let previousCursor = value.eventCursor - value.events.length;
  for (const event of value.events) {
    if (
      !Number.isSafeInteger(event.cursor) ||
      event.cursor <= previousCursor ||
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
    previousCursor = event.cursor;
  }
  const refs = new Set<string>();
  const resources = new Set<string>();
  for (const target of value.targets) {
    const resource = `${target.kind}:${target.targetId}`;
    if (
      !['entity', 'poi'].includes(target.kind) ||
      !target.ref?.trim() ||
      !target.targetId?.trim() ||
      !Number.isSafeInteger(target.revision) ||
      target.revision < 1 ||
      refs.has(target.ref) ||
      resources.has(resource)
    )
      throw new TypeError('Character snapshot target is invalid or duplicated.');
    refs.add(target.ref);
    resources.add(resource);
  }
  if (!Number.isSafeInteger(value.targetSequence) || value.targetSequence < value.targets.length)
    throw new TypeError('Character snapshot target sequence is invalid.');
  const requestIds = new Set<string>();
  for (const requestId of value.requestIds) {
    if (typeof requestId !== 'string' || !requestId.trim() || requestId.length > 256 || requestIds.has(requestId))
      throw new TypeError('Character snapshot request id is invalid or duplicated.');
    requestIds.add(requestId);
  }
  if (
    !Number.isFinite(value.hunger) ||
    value.hunger < 0 ||
    value.hunger > 100 ||
    typeof value.lastBehavior !== 'string' ||
    !value.lastBehavior.trim() ||
    !Number.isFinite(value.stalledSeconds) ||
    value.stalledSeconds < 0 ||
    !Number.isFinite(value.refreshSeconds) ||
    value.refreshSeconds < 0 ||
    !Number.isFinite(value.dangerSecondsRemaining) ||
    value.dangerSecondsRemaining < 0 ||
    (value.executionTargetId !== undefined && !value.executionTargetId.trim()) ||
    (value.actionId !== undefined && !value.actionId.trim())
  )
    throw new TypeError('Character snapshot execution state is invalid.');
  if (value.lifecycle === 'deceased' && (value.actionId || value.suspendedGoal || value.inventory.some(Boolean)))
    throw new TypeError('Deceased character snapshot retains active execution state.');
}

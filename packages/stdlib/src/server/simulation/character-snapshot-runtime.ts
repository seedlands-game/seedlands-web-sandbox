import type { CharacterEvent } from '../../runtime/character-control-protocol';
import { createBehaviorRecord, type CharacterBehaviorRuntime } from './character-behavior-runtime';
import { behaviorDefinitionForLegacyGoal } from './character-behavior-definition';
import type {
  CharacterRecord,
  CharacterRuntimeOptions,
  CharacterSnapshot,
  CharacterTargetBinding,
} from './character-runtime-types';
import {
  cloneCharacterGoalState,
  validateCharacterActionLink,
  validateCharacterSnapshotRecord,
} from './character-runtime-validation';

export const characterStateFields = (record: CharacterRecord) => ({
  entityId: record.entityId,
  lifecycle: record.lifecycle,
  incarnation: record.incarnation,
  revision: record.revision,
  policyRevision: record.policyRevision,
  profile: { ...record.profile },
  currentGoal: cloneCharacterGoalState(record.currentGoal),
  memory: { ...record.memory },
  eventCursor: record.eventCursor,
  ...(record.lastSpeech ? { lastSpeech: record.lastSpeech } : {}),
});

export function snapshotCharacterRecords(
  records: ReadonlyMap<string, CharacterRecord>,
  sequence: number,
  include: (record: CharacterRecord) => boolean = () => true,
): CharacterSnapshot {
  return {
    version: 2,
    sequence,
    characters: [...records.values()].filter(include).map((record) => ({
      ...characterStateFields(record),
      ...(record.creation ? { creation: { ...record.creation } } : {}),
      events: record.events.map((event) => ({ ...event, ...(event.target ? { target: { ...event.target } } : {}) })),
      homePosition: [...record.homePosition],
      targets: record.targets.map((target) => ({ ...target })),
      targetSequence: record.targetSequence,
      requestIds: [...record.requestIds],
      ...(record.executionTargetId ? { executionTargetId: record.executionTargetId } : {}),
      ...(record.actionId ? { actionId: record.actionId } : {}),
      lastPosition: [...record.lastPosition],
      stalledSeconds: record.stalledSeconds,
      refreshSeconds: record.refreshSeconds,
      ...(record.suspendedGoal ? { suspendedGoal: cloneCharacterGoalState(record.suspendedGoal) } : {}),
      lastBehavior: record.lastBehavior,
      dangerSecondsRemaining: record.dangerSecondsRemaining,
      ...(record.lastThreatEntityId ? { lastThreatEntityId: record.lastThreatEntityId } : {}),
      behaviorTree: JSON.parse(JSON.stringify(record.behaviorTree)),
    })),
  };
}

export function pruneCharacterTombstones(records: Map<string, CharacterRecord>, limit = 128): void {
  const deceased = [...records.values()].filter((record) => record.lifecycle === 'deceased');
  for (const record of deceased.slice(0, Math.max(0, deceased.length - limit))) records.delete(record.entityId);
}

export function restoreCharacterTombstones(
  raw: unknown,
  options: CharacterRuntimeOptions,
  behaviors: CharacterBehaviorRuntime,
  records: Map<string, CharacterRecord>,
  currentSequence: number,
): number {
  const { records: tombstones, sequence } = restoreCharacterRecords(raw, options, behaviors);
  if ([...tombstones.values()].some((record) => record.lifecycle !== 'deceased'))
    throw new TypeError('Character tombstone snapshot contains an active actor.');
  if (tombstones.size > 128) throw new RangeError('Character tombstone budget exceeded.');
  for (const [id, record] of tombstones) {
    if (records.has(id)) throw new TypeError('Character tombstone duplicates an active actor.');
    records.set(id, record);
  }
  return Math.max(currentSequence, sequence);
}

export function restoreCharacterRecords(
  raw: unknown,
  options: CharacterRuntimeOptions,
  behaviors: CharacterBehaviorRuntime,
): Readonly<{ records: Map<string, CharacterRecord>; sequence: number }> {
  const snapshot = raw as CharacterSnapshot;
  if (
    !snapshot ||
    ![1, 2].includes(snapshot.version) ||
    !Number.isSafeInteger(snapshot.sequence) ||
    !Number.isSafeInteger(snapshot.sequence + 1) ||
    snapshot.sequence < 0 ||
    !Array.isArray(snapshot.characters)
  )
    throw new TypeError('Character snapshot header is invalid.');
  const records = new Map<string, CharacterRecord>();
  const creationIds = new Set<string>();
  for (const value of snapshot.characters) {
    validateCharacterSnapshotRecord(value, options.capabilities, options.entities.items);
    if (value.creation) {
      if (creationIds.has(value.creation.id)) throw new TypeError('Duplicate character creation identity.');
      creationIds.add(value.creation.id);
    }
    validateCharacterActionLink(value, value.actionId ? options.action(value.actionId) : null);
    if (
      records.has(value.entityId) ||
      (value.lifecycle === 'active' && !options.actor(value.entityId)) ||
      (value.lifecycle === 'deceased' && options.actor(value.entityId))
    )
      throw new TypeError('Character snapshot actor lifecycle is invalid or duplicated.');
    const migrated =
      value.behaviorTree ??
      createBehaviorRecord(
        { description: `Continue ${value.currentGoal.goal.kind}.` },
        behaviorDefinitionForLegacyGoal(
          value.currentGoal.goal,
          value.homePosition,
          value.hunger ?? options.domain.read(value.entityId)?.needs.hunger,
        ),
        options.capabilities,
        1,
        value.eventCursor,
      );
    if (snapshot.version === 2 && !value.behaviorTree) throw new TypeError('Character behavior snapshot is missing.');
    const restored: CharacterRecord = {
      ...value,
      version: 1,
      profile: { ...value.profile },
      currentGoal: cloneCharacterGoalState(value.currentGoal),
      memory: { ...value.memory },
      events: value.events.map((event: CharacterEvent) => ({
        ...event,
        ...(event.target ? { target: { ...event.target } } : {}),
      })),
      homePosition: [...value.homePosition],
      targets: value.targets.map((target: CharacterTargetBinding) => ({ ...target })),
      requestIds: [...value.requestIds],
      lastPosition: [...value.lastPosition],
      ...(value.suspendedGoal ? { suspendedGoal: cloneCharacterGoalState(value.suspendedGoal) } : {}),
      behaviorTree: JSON.parse(JSON.stringify(migrated)),
    };
    delete (restored as CharacterRecord & { inventory?: unknown }).inventory;
    delete (restored as CharacterRecord & { hunger?: unknown }).hunger;
    behaviors.rebuildAfterRestore(restored);
    if (restored.lifecycle === 'active') {
      const body = options.domain.read(value.entityId);
      if (!body) throw new TypeError('Character snapshot actor body is missing.');
      const installed = options.entities.installActorCharacterComponent(value.entityId, restored, body.controlRevision);
      if (!installed) throw new TypeError('Character snapshot component was not installed.');
      records.set(value.entityId, installed as CharacterRecord);
    } else records.set(value.entityId, restored);
  }
  return { records, sequence: snapshot.sequence };
}

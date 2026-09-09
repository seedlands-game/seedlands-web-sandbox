import { CharacterObservationRuntime } from './character-observation-runtime';
import type {
  CharacterControlRequest,
  CharacterControlResult,
  CharacterEvent,
  CharacterProfile,
  CharacterState,
  CharacterTargetRef,
  CharacterBehaviorInput,
} from '../../runtime/character-control-protocol';
import { createLifeBehavior } from '../../runtime/character-control-protocol';
import type { GameplayEntity } from '../gameplay/entity-store';
import { CharacterBehaviorRuntime, createBehaviorRecord } from './character-behavior-runtime';
import {
  behaviorCapabilities,
  behaviorDefinitionForLegacyGoal,
  validateBehavior,
} from './character-behavior-definition';
import {
  CHARACTER_MAX_DIALOGUE_TEXT,
  CHARACTER_MAX_EVENTS,
  CHARACTER_MAX_MEMORY_TEXT,
  CHARACTER_MAX_SPEECH_TEXT,
  createCharacterInventory,
  type CharacterRecord,
  type CharacterRuntimeOptions as Options,
  type CharacterSnapshot,
  type CharacterTargetBinding as TargetBinding,
} from './character-runtime-types';
import {
  characterPosition as position,
  characterText as text,
  cloneCharacterGoal as cloneGoal,
  cloneCharacterGoalState as cloneGoalState,
  sameCharacterGoal as sameGoal,
  validateCharacterGoal,
  validateCharacterActionLink,
  validateCharacterProfile,
  validateCharacterSnapshotRecord,
} from './character-runtime-validation';
import type { ActorPersistentGoal } from './actor-state';

const MOVEMENT_REFRESH_SECONDS = 1;

export type { CharacterSnapshot } from './character-runtime-types';

export class CharacterControlFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(`${code}: ${message}`);
  }
}

export class CharacterRuntime {
  private readonly records = new Map<string, CharacterRecord>();
  private readonly behaviors: CharacterBehaviorRuntime;
  private readonly observations: CharacterObservationRuntime;
  private sequence = 0;

  constructor(private readonly options: Options) {
    this.observations = new CharacterObservationRuntime(
      options,
      (record) => this.state(record),
      (id) => this.requireEntity(id),
    );
    this.behaviors = new CharacterBehaviorRuntime(options, {
      record: (record, type, fields) => this.record(record, type, fields),
      resolveTargetRef: (record, ref) => {
        const binding = record.targets.find((entry) => entry.kind === 'entity' && entry.ref === ref);
        return binding && this.observations.isVisible(record, 'entity', binding.targetId) ? binding.targetId : null;
      },
    });
  }

  retainedActionIds(): string[] {
    return [...this.records.values()].flatMap((record) => [
      ...(record.actionId ? [record.actionId] : []),
      ...record.behaviorTree.skills.flatMap((entry) => (entry.actionId ? [entry.actionId] : [])),
    ]);
  }

  has(entityId: string): boolean {
    return this.records.get(entityId)?.lifecycle === 'active';
  }

  validateRegistration(
    profile: CharacterProfile,
    homePosition: readonly number[],
    behaviorTree?: CharacterBehaviorInput,
  ): void {
    validateCharacterProfile(profile);
    position(homePosition, 'Character home position');
    if (behaviorTree) validateBehavior(behaviorTree.goal, behaviorTree.definition);
  }

  createdForRequest(id: string, fingerprint: string): CharacterState | null {
    const previous = [...this.records.values()].find((record) => record.creation?.id === id);
    if (!previous) return null;
    if (previous.creation?.fingerprint !== fingerprint)
      throw new CharacterControlFailure('CHARACTER_CREATION_CONFLICT', 'Creation request payload changed.');
    return this.state(previous);
  }

  register(
    entityId: string,
    profile: CharacterProfile,
    homePosition: readonly number[],
    behaviorTree?: CharacterBehaviorInput,
    creation?: CharacterRecord['creation'],
  ): CharacterState {
    if (this.records.has(entityId)) throw new Error(`Character already exists: ${entityId}`);
    validateCharacterProfile(profile);
    const entity = this.requireEntity(entityId);
    const home = position(homePosition, 'Character home position');
    const policy =
      behaviorTree ??
      createLifeBehavior({
        homePosition: home,
        patrolPositions: [
          [home[0] + 3, home[1], home[2]],
          [home[0], home[1], home[2] + 3],
        ],
      });
    const record: CharacterRecord = {
      ...(creation ? { creation: { ...creation } } : {}),
      lifecycle: 'active',
      entityId,
      incarnation: `character-${++this.sequence}`,
      revision: 0,
      policyRevision: 1,
      profile: { ...profile },
      currentGoal: { revision: 0, requestId: 'fallback-life', goal: { kind: 'forage' }, status: 'active' },
      memory: { revision: 0, throughCursor: 0, summary: '' },
      inventory: createCharacterInventory(),
      events: [],
      eventCursor: 0,
      homePosition: home,
      targets: [],
      targetSequence: 0,
      requestIds: [],
      lastPosition: [...entity.position],
      stalledSeconds: 0,
      refreshSeconds: 0,
      lastBehavior: 'idle',
      hunger: this.options.actor(entityId)?.hunger ?? 0,
      dangerSecondsRemaining: 0,
      behaviorTree: createBehaviorRecord(policy.goal, policy.definition),
    };
    this.records.set(entityId, record);
    this.options.changed();
    return this.state(record);
  }

  unregister(entityId: string, reason = 'entity-removed'): void {
    const record = this.records.get(entityId);
    if (!record || record.lifecycle === 'deceased') return;
    const entity = this.options.entities.get(entityId);
    const actor = this.options.actor(entityId);
    if (entity) record.lastPosition = [...entity.position];
    if (actor) record.hunger = actor.hunger;
    record.lastBehavior = 'deceased';
    record.lifecycle = 'deceased';
    record.policyRevision += 1;
    record.revision += 1;
    this.behaviors.dispose(record, reason);
    record.actionId = undefined;
    record.executionTargetId = undefined;
    record.suspendedGoal = undefined;
    record.dangerSecondsRemaining = 0;
    if (record.currentGoal.status === 'active' || record.currentGoal.status === 'suspended') {
      record.currentGoal = { ...record.currentGoal, status: 'failed', reason };
      this.record(record, 'goal-interrupted', { reason });
    }
    for (const stack of record.inventory.clear())
      this.options.entities.spawn({ type: 'world-item', position: record.lastPosition, stack });
    this.options.changed();
  }

  execute(request: Exclude<CharacterControlRequest, { kind: 'create' }>): CharacterControlResult {
    if (!request || typeof request !== 'object') throw new TypeError('Character request is invalid.');
    if (request.kind === 'capabilities') return { kind: 'capabilities', capabilities: behaviorCapabilities() };
    if (request.kind === 'list')
      return {
        kind: 'list',
        characters: [...this.records.values()]
          .sort((a, b) => a.entityId.localeCompare(b.entityId))
          .map((record) => this.state(record)),
      };
    if (!['inspect', 'observe', 'dialogue', 'speak', 'memory', 'intent', 'behavior'].includes(request.kind))
      throw new TypeError('Character request kind is invalid.');
    const record = this.requireRecord(request.entityId);
    if (request.kind === 'inspect') return { kind: 'state', character: this.state(record) };
    if (request.kind === 'observe')
      return {
        kind: 'observation',
        observation: this.observations.observe(record, request.sinceCursor, request.throughCursor),
      };
    if (request.kind === 'dialogue') {
      this.requireActive(record);
      return {
        kind: 'dialogue',
        event: this.record(record, 'dialogue-heard', {
          text: text(request.text, 'Dialogue', CHARACTER_MAX_DIALOGUE_TEXT),
        }),
      };
    }
    if (request.kind === 'speak') {
      this.requireActive(record);
      const requestId = text(request.requestId, 'Speech request id', 256);
      const prior = record.events.find((event) => event.type === 'speech' && event.reason === requestId);
      if (prior) return { kind: 'speak', event: { ...prior }, character: this.state(record) };
      const event = this.record(record, 'speech', {
        text: text(request.text, 'Character speech', CHARACTER_MAX_SPEECH_TEXT),
        reason: requestId,
      });
      record.lastSpeech = event.text;
      record.requestIds = [...record.requestIds.filter((id) => id !== requestId), requestId].slice(-64);
      return { kind: 'speak', event, character: this.state(record) };
    }
    if (request.kind === 'memory') return { kind: 'memory', character: this.updateMemory(record, request) };
    if (request.kind === 'behavior')
      return { kind: 'behavior', accepted: true, character: this.applyBehavior(record, request) };
    return { kind: 'intent', accepted: true, character: this.applyIntent(record, request) };
  }

  recordAttacked(entityId: string, attackerId: string): void {
    const record = this.records.get(entityId);
    if (!record || record.lifecycle !== 'active') return;
    const target = this.observations.reference(record, 'entity', attackerId);
    record.lastThreatEntityId = attackerId;
    record.dangerSecondsRemaining = 3;
    this.record(record, 'attacked', { target });
    this.options.changed();
  }

  advance(seconds: number): void {
    for (const record of this.records.values()) this.behaviors.advance(record, seconds);
  }

  snapshot(): CharacterSnapshot {
    return {
      version: 2,
      sequence: this.sequence,
      characters: [...this.records.values()].map((record) => ({
        ...this.stateFields(record),
        ...(record.creation ? { creation: { ...record.creation } } : {}),
        inventory: record.inventory.snapshot(),
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
        ...(record.suspendedGoal ? { suspendedGoal: cloneGoalState(record.suspendedGoal) } : {}),
        lastBehavior: record.lastBehavior,
        hunger: record.hunger,
        dangerSecondsRemaining: record.dangerSecondsRemaining,
        ...(record.lastThreatEntityId ? { lastThreatEntityId: record.lastThreatEntityId } : {}),
        behaviorTree: JSON.parse(JSON.stringify(record.behaviorTree)),
      })),
    };
  }

  persistentGoalFor(entityId: string): ActorPersistentGoal | null {
    const record = this.records.get(entityId);
    if (
      !record ||
      record.lifecycle !== 'active' ||
      (record.currentGoal.status !== 'active' && record.currentGoal.status !== 'suspended')
    )
      return null;
    return { kind: record.currentGoal.goal.kind, status: record.currentGoal.status };
  }

  restore(raw: unknown): void {
    if (raw === undefined) {
      this.records.clear();
      this.sequence = 0;
      return;
    }
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
    const next = new Map<string, CharacterRecord>();
    const creationIds = new Set<string>();
    for (const value of snapshot.characters) {
      validateCharacterSnapshotRecord(value);
      if (value.creation) {
        if (creationIds.has(value.creation.id)) throw new TypeError('Duplicate character creation identity.');
        creationIds.add(value.creation.id);
      }
      validateCharacterActionLink(value, value.actionId ? this.options.action(value.actionId) : null);
      if (
        next.has(value.entityId) ||
        (value.lifecycle === 'active' && !this.options.actor(value.entityId)) ||
        (value.lifecycle === 'deceased' && this.options.actor(value.entityId))
      )
        throw new TypeError('Character snapshot actor lifecycle is invalid or duplicated.');
      const migrated =
        value.behaviorTree ??
        createBehaviorRecord(
          { description: `Continue ${value.currentGoal.goal.kind}.` },
          behaviorDefinitionForLegacyGoal(value.currentGoal.goal, value.homePosition, value.hunger),
        );
      if (snapshot.version === 2 && !value.behaviorTree) throw new TypeError('Character behavior snapshot is missing.');
      const restored: CharacterRecord = {
        ...value,
        profile: { ...value.profile },
        currentGoal: cloneGoalState(value.currentGoal),
        memory: { ...value.memory },
        inventory: createCharacterInventory(value.inventory),
        events: value.events.map((event: CharacterEvent) => ({
          ...event,
          ...(event.target ? { target: { ...event.target } } : {}),
        })),
        homePosition: [...value.homePosition],
        targets: value.targets.map((target: TargetBinding) => ({ ...target })),
        requestIds: [...value.requestIds],
        lastPosition: [...value.lastPosition],
        ...(value.suspendedGoal ? { suspendedGoal: cloneGoalState(value.suspendedGoal) } : {}),
        behaviorTree: JSON.parse(JSON.stringify(migrated)),
      };
      this.behaviors.rebuildAfterRestore(restored);
      next.set(value.entityId, restored);
    }
    this.records.clear();
    next.forEach((record, id) => this.records.set(id, record));
    this.sequence = snapshot.sequence;
  }

  private applyIntent(record: CharacterRecord, request: Extract<CharacterControlRequest, { kind: 'intent' }>) {
    this.requireActive(record);
    text(request.requestId, 'Character request id', 256);
    if (
      request.expectedCursor !== undefined &&
      (!Number.isSafeInteger(request.expectedCursor) || request.expectedCursor < 0)
    )
      throw new TypeError('Character event cursor is invalid.');
    if (record.requestIds.includes(request.requestId)) return this.state(record);
    if (request.expectedRevision !== record.revision)
      throw new CharacterControlFailure('CHARACTER_REVISION_CONFLICT', 'Character revision changed.');
    if (request.expectedCursor !== undefined && request.expectedCursor !== record.eventCursor)
      throw new CharacterControlFailure('CHARACTER_REVISION_CONFLICT', 'Character event cursor changed.');
    validateCharacterGoal(request.goal);
    const speech =
      request.say === undefined || request.say === ''
        ? undefined
        : text(request.say, 'Character speech', CHARACTER_MAX_SPEECH_TEXT);
    let executionTargetId = sameGoal(record.currentGoal.goal, request.goal) ? record.executionTargetId : undefined;
    if (request.goal.kind === 'follow')
      executionTargetId = this.resolveVisibleTarget(record, request.goal.target, 'entity');
    const retainsAction =
      record.currentGoal.status === 'active' &&
      sameGoal(record.currentGoal.goal, request.goal) &&
      record.executionTargetId === executionTargetId;
    if (!retainsAction) this.behaviors.dispose(record, 'goal-replaced');
    record.revision += 1;
    record.currentGoal = {
      revision: record.revision,
      requestId: request.requestId,
      goal: cloneGoal(request.goal),
      status: 'active',
    };
    record.requestIds = [...record.requestIds, request.requestId].slice(-64);
    if (!retainsAction) {
      record.executionTargetId = executionTargetId;
      record.actionId = undefined;
      record.stalledSeconds = 0;
      record.refreshSeconds = MOVEMENT_REFRESH_SECONDS;
      record.lastPosition = [...this.requireEntity(record.entityId).position];
      this.record(record, 'goal-started');
    }
    if (speech) {
      record.lastSpeech = speech;
      this.record(record, 'speech', { text: speech });
    }
    if (!retainsAction)
      this.behaviors.install(
        record,
        { description: `Character goal: ${request.goal.kind}.` },
        behaviorDefinitionForLegacyGoal(request.goal, record.homePosition, this.options.actor(record.entityId)?.hunger),
      );
    if (!retainsAction) this.behaviors.advance(record, 0);
    this.options.changed();
    return this.state(record);
  }

  private applyBehavior(
    record: CharacterRecord,
    request: Extract<CharacterControlRequest, { kind: 'behavior' }>,
  ): CharacterState {
    this.requireActive(record);
    text(request.requestId, 'Behavior request id', 256);
    if (record.requestIds.includes(request.requestId)) return this.state(record);
    if (!Number.isSafeInteger(request.expectedBehaviorRevision) || request.expectedBehaviorRevision < 0)
      throw new TypeError('Expected behavior revision is invalid.');
    validateBehavior(request.goal, request.definition);
    if (request.expectedBehaviorRevision !== record.behaviorTree.revision)
      throw new CharacterControlFailure('CHARACTER_BEHAVIOR_CONFLICT', 'Character behavior revision changed.');
    this.behaviors.install(record, request.goal, request.definition);
    record.revision += 1;
    record.currentGoal = {
      revision: record.revision,
      requestId: request.requestId,
      goal: { kind: 'idle' },
      status: 'active',
    };
    record.requestIds = [...record.requestIds.filter((id) => id !== request.requestId), request.requestId].slice(-64);
    this.record(record, 'behavior-updated', { reason: request.requestId });
    this.behaviors.advance(record, 0);
    this.options.changed();
    return this.state(record);
  }

  private updateMemory(record: CharacterRecord, request: Extract<CharacterControlRequest, { kind: 'memory' }>) {
    if (request.expectedMemoryRevision !== record.memory.revision)
      throw new CharacterControlFailure('CHARACTER_MEMORY_CONFLICT', 'Character memory revision changed.');
    if (
      !Number.isSafeInteger(request.throughCursor) ||
      request.throughCursor < 0 ||
      request.throughCursor > record.eventCursor
    )
      throw new TypeError('Character memory cursor is invalid.');
    record.memory = {
      revision: record.memory.revision + 1,
      throughCursor: request.throughCursor,
      summary: text(request.summary, 'Character memory summary', CHARACTER_MAX_MEMORY_TEXT, true),
    };
    this.options.changed();
    return this.state(record);
  }

  private resolveVisibleTarget(record: CharacterRecord, target: CharacterTargetRef, kind: TargetBinding['kind']) {
    const binding = record.targets.find((candidate) => candidate.ref === target.ref);
    if (
      !binding ||
      binding.kind !== kind ||
      binding.revision !== target.revision ||
      !this.observations.isVisible(record, kind, binding.targetId)
    )
      throw new CharacterControlFailure('CHARACTER_TARGET_UNAVAILABLE', 'Character target is unavailable.');
    return binding.targetId;
  }

  private record(
    record: CharacterRecord,
    type: CharacterEvent['type'],
    fields: Omit<Partial<CharacterEvent>, 'cursor' | 'at' | 'type'> = {},
  ): CharacterEvent {
    const event = { cursor: ++record.eventCursor, at: this.options.now(), type, ...fields };
    if (type === 'speech' && event.text) record.lastSpeech = event.text;
    record.events.push(event);
    record.events = record.events.slice(-CHARACTER_MAX_EVENTS);
    this.options.changed();
    return { ...event };
  }

  private state(record: CharacterRecord): CharacterState {
    const actor = this.options.actor(record.entityId);
    if (record.lifecycle === 'active' && !actor)
      throw new CharacterControlFailure('CHARACTER_UNAVAILABLE', 'Character is unavailable.');
    return {
      ...this.stateFields(record),
      inventory: record.inventory.snapshot(),
      behavior: actor?.behavior ?? record.lastBehavior,
      hunger: actor?.hunger ?? record.hunger,
      behaviorTree: this.behaviors.state(record),
    };
  }

  private stateFields(record: CharacterRecord) {
    return {
      entityId: record.entityId,
      lifecycle: record.lifecycle,
      incarnation: record.incarnation,
      revision: record.revision,
      policyRevision: record.policyRevision,
      profile: { ...record.profile },
      currentGoal: cloneGoalState(record.currentGoal),
      memory: { ...record.memory },
      eventCursor: record.eventCursor,
      ...(record.lastSpeech ? { lastSpeech: record.lastSpeech } : {}),
    };
  }

  private requireRecord(entityId: string): CharacterRecord {
    const record = this.records.get(entityId);
    if (!record) throw new CharacterControlFailure('CHARACTER_UNAVAILABLE', 'Character is unavailable.');
    return record;
  }

  private requireActive(record: CharacterRecord): void {
    if (record.lifecycle !== 'active')
      throw new CharacterControlFailure('CHARACTER_UNAVAILABLE', 'Character is unavailable.');
  }

  private requireEntity(entityId: string): GameplayEntity {
    const entity = this.options.entities.get(entityId);
    if (!entity || entity.type !== 'npc' || entity.archetype !== 'settler')
      throw new CharacterControlFailure('CHARACTER_UNAVAILABLE', 'Character is unavailable.');
    return entity;
  }
}

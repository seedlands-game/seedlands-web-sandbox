import { CharacterObservationRuntime } from './character-observation-runtime';
import type {
  CharacterActorBinding,
  CharacterControlRequest,
  CharacterControlResult,
  CharacterEvent,
  CharacterProfile,
  CharacterState,
  CharacterTargetRef,
  CharacterBehaviorInput,
} from '../../runtime/character-control-protocol';
import type { BehaviorActorSnapshot } from '../composition/behavior-capability-registry';
import type { BehaviorJson } from '../../runtime/behavior-control-protocol';
import type { GameplayEntity } from '../gameplay/entity-store';
import { CharacterBehaviorRuntime } from './character-behavior-runtime';
import { characterBehaviorPolicy, createBehaviorRecord, validateActorBehavior } from './character-behavior-admission';
import {
  behaviorDefinitionForLegacyGoal,
  behaviorMayStartAction,
  validateBehavior,
} from './character-behavior-definition';
import {
  CHARACTER_MAX_DIALOGUE_TEXT,
  CHARACTER_MAX_EVENTS,
  CHARACTER_MAX_MEMORY_TEXT,
  CHARACTER_MAX_SPEECH_TEXT,
  type CharacterRecord,
  type CharacterRuntimeOptions as Options,
  type CharacterSnapshot,
  type CharacterTargetBinding as TargetBinding,
} from './character-runtime-types';
import {
  characterPosition as position,
  characterText as text,
  cloneCharacterGoal as cloneGoal,
  sameCharacterGoal as sameGoal,
  validateCharacterGoal,
  validateCharacterActionLink,
  validateCharacterProfile,
  validateCharacterSnapshotRecord,
} from './character-runtime-validation';
import type { ActorPersistentGoal } from './actor-state';
import {
  characterStateFields,
  pruneCharacterTombstones,
  restoreCharacterRecords,
  restoreCharacterTombstones,
  snapshotCharacterRecords,
} from './character-snapshot-runtime';
import { characterAdvanceCommitUpperBound } from './character-advance-capacity';

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
    candidate?: Readonly<{ entityId: string; kind: 'npc' | 'creature' }>,
  ): void {
    if (!Number.isSafeInteger(this.sequence + 1)) throw new RangeError('Character sequence is exhausted.');
    validateCharacterProfile(profile);
    const home = position(homePosition, 'Character home position');
    const policy = characterBehaviorPolicy(home, behaviorTree);
    validateBehavior(policy.goal, policy.definition, this.options.capabilities);
    if (candidate) validateActorBehavior(this.options, candidate.entityId, policy.definition, candidate.kind);
    if (!this.options.canStartAction() && behaviorMayStartAction(policy.definition))
      throw new RangeError('Action sequence is exhausted.');
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
    this.validateRegistration(profile, homePosition, behaviorTree);
    const entity = this.requireEntity(entityId);
    const body = this.options.domain.read(entityId);
    if (!body || (body.controlSource !== 'autonomous' && body.controlSource !== 'none'))
      throw new CharacterControlFailure('CHARACTER_CONTROL_CONFLICT', 'Actor already has another control owner.');
    const home = position(homePosition, 'Character home position');
    const policy = characterBehaviorPolicy(home, behaviorTree);
    validateActorBehavior(this.options, entityId, policy.definition);
    const record: CharacterRecord = {
      version: 1,
      ...(creation ? { creation: { ...creation } } : {}),
      lifecycle: 'active',
      entityId,
      incarnation: `character-${++this.sequence}`,
      revision: 0,
      policyRevision: 1,
      profile: { ...profile },
      currentGoal: { revision: 0, requestId: 'fallback-life', goal: { kind: 'forage' }, status: 'active' },
      memory: { revision: 0, throughCursor: 0, summary: '' },
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
      dangerSecondsRemaining: 0,
      behaviorTree: createBehaviorRecord(policy.goal, policy.definition, this.options.capabilities),
    };
    const installed = this.options.entities.installActorCharacterComponent(entityId, record, body.controlRevision);
    if (!installed) throw new Error('Character behavior component was not installed.');
    this.options.interruptAction(entityId, 'control-replaced');
    this.records.set(entityId, installed as CharacterRecord);
    this.options.changed();
    return this.state(installed as CharacterRecord);
  }

  unregister(entityId: string, reason = 'entity-removed'): void {
    const record = this.records.get(entityId);
    if (!record || record.lifecycle === 'deceased') return;
    const entity = this.options.entities.get(entityId);
    if (entity) record.lastPosition = [...entity.position];
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
    if (entity) this.options.entities.installActorCharacterComponent(entityId, null);
    pruneCharacterTombstones(this.records);
    this.options.changed();
  }

  execute(
    request: Exclude<CharacterControlRequest, { kind: 'create' }>,
    actorBinding?: CharacterActorBinding,
  ): CharacterControlResult {
    if (!request || typeof request !== 'object') throw new TypeError('Character request is invalid.');
    if (request.kind === 'capabilities') {
      if (!request.entityId) return { kind: 'capabilities', capabilities: this.options.capabilities.catalog() };
      const body = this.options.domain.read(request.entityId);
      const binding = actorBinding ?? body?.reference ?? { entityId: request.entityId, epoch: 0, lifetime: 0 };
      return {
        kind: 'capabilities',
        capabilities: this.options.capabilities.catalogForActor(
          binding,
          this.behaviorActorSnapshot(body),
          (capability) => this.options.domain.allowsCapability(request.entityId!, capability),
        ),
      };
    }
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

  private behaviorActorSnapshot(body: ReturnType<Options['domain']['read']>): BehaviorActorSnapshot | null {
    if (!body || body.controlSource !== 'behavior') return null;
    return Object.freeze({
      reference: body.reference,
      lifecycle: body.lifecycle,
      controlSource: 'behavior' as const,
      health: body.health,
      maxHealth: body.maxHealth,
      needs: body.needs,
      inventory: Object.freeze({
        slots: Object.freeze(
          body.inventory.slots.map((slot) =>
            slot === null ? null : (JSON.parse(JSON.stringify(slot)) as BehaviorJson),
          ),
        ),
        selectedSlot: body.inventory.selectedSlot,
        revision: body.inventory.revision,
      }),
    });
  }

  recordAttacked(entityId: string, attackerId: string, notifyChange = true): void {
    const record = this.records.get(entityId);
    if (!record || record.lifecycle !== 'active') return;
    const target = this.observations.reference(record, 'entity', attackerId);
    record.lastThreatEntityId = attackerId;
    record.dangerSecondsRemaining = 3;
    this.record(record, 'attacked', { target });
    if (notifyChange) this.options.changed();
  }

  advance(seconds: number): void {
    for (const record of this.records.values()) {
      if (this.failLostFollow(record)) continue;
      this.behaviors.advance(record, seconds);
    }
  }

  advanceCommitUpperBound(stepCount: number, externalOperationCount = 0): number {
    return characterAdvanceCommitUpperBound(this.records.values(), stepCount, externalOperationCount);
  }

  snapshot(): CharacterSnapshot {
    return snapshotCharacterRecords(this.records, this.sequence);
  }

  tombstoneSnapshot(): CharacterSnapshot {
    return snapshotCharacterRecords(this.records, this.sequence, (record) => record.lifecycle === 'deceased');
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
      this.restoreFromComponents();
      return;
    }
    const { records: next, sequence } = restoreCharacterRecords(raw, this.options, this.behaviors);
    this.records.clear();
    next.forEach((record, id) => this.records.set(id, record));
    this.sequence = sequence;
  }

  restoreTombstones(raw: unknown): void {
    this.sequence = restoreCharacterTombstones(raw, this.options, this.behaviors, this.records, this.sequence);
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
    const nextDefinition = behaviorDefinitionForLegacyGoal(
      request.goal,
      record.homePosition,
      this.options.domain.read(record.entityId)?.needs.hunger,
    );
    if (!this.options.canStartAction() && behaviorMayStartAction(nextDefinition))
      throw new RangeError('Action sequence is exhausted.');
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
      this.behaviors.install(record, { description: `Character goal: ${request.goal.kind}.` }, nextDefinition);
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
    validateBehavior(request.goal, request.definition, this.options.capabilities);
    if (request.expectedBehaviorRevision !== record.behaviorTree.revision)
      throw new CharacterControlFailure('CHARACTER_BEHAVIOR_CONFLICT', 'Character behavior revision changed.');
    if (!this.options.canStartAction() && behaviorMayStartAction(request.definition))
      throw new RangeError('Action sequence is exhausted.');
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
    const body = this.options.domain.read(record.entityId);
    if (record.lifecycle === 'active' && (!actor || !body))
      throw new CharacterControlFailure('CHARACTER_UNAVAILABLE', 'Character is unavailable.');
    return {
      ...characterStateFields(record),
      inventory: body?.inventory.slots ?? Array.from({ length: 24 }, () => null),
      behavior: actor?.behavior ?? record.lastBehavior,
      hunger: body?.needs.hunger ?? 0,
      behaviorTree: this.behaviors.state(record, { evaluateMilestones: record.lifecycle === 'active' }),
    };
  }

  restoreFromComponents(): void {
    const next = new Map<string, CharacterRecord>();
    let maximum = 0;
    for (const entity of this.options.entities.query({ type: 'npc' })) {
      const component = this.options.entities.bindActorCharacterComponent(entity.id);
      if (!component) continue;
      validateCharacterSnapshotRecord(component, this.options.capabilities);
      validateCharacterActionLink(component, component.actionId ? this.options.action(component.actionId) : null);
      this.behaviors.rebuildAfterRestore(component as CharacterRecord);
      next.set(entity.id, component as CharacterRecord);
      const match = /^character-([1-9]\d*)$/.exec(component.incarnation);
      const ordinal = Number(match?.[1]);
      if (!match || !Number.isSafeInteger(ordinal) || !Number.isSafeInteger(ordinal + 1))
        throw new TypeError('Character component incarnation is invalid or exhausted.');
      maximum = Math.max(maximum, ordinal);
    }
    this.records.clear();
    next.forEach((record, id) => this.records.set(id, record));
    this.sequence = maximum;
  }

  private failLostFollow(record: CharacterRecord): boolean {
    if (
      record.lifecycle !== 'active' ||
      record.currentGoal.status !== 'active' ||
      record.currentGoal.goal.kind !== 'follow' ||
      !record.executionTargetId ||
      this.observations.isVisible(record, 'entity', record.executionTargetId)
    )
      return false;
    this.behaviors.dispose(record, 'target-unavailable');
    record.executionTargetId = undefined;
    record.actionId = undefined;
    record.currentGoal = { ...record.currentGoal, status: 'failed', reason: 'target-unavailable' };
    this.record(record, 'target-lost', { reason: 'target-unavailable' });
    this.record(record, 'goal-failed', { reason: 'target-unavailable' });
    return true;
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

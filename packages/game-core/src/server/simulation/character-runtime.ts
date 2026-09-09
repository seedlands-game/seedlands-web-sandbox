import type {
  CharacterControlRequest,
  CharacterControlResult,
  CharacterEvent,
  CharacterObservation,
  CharacterProfile,
  CharacterState,
  CharacterTargetRef,
} from '../../runtime/character-control-protocol';
import {
  CHARACTER_OBSERVATION_MAX_EVENTS,
  CHARACTER_OBSERVATION_MAX_VISIBLE_ENTITIES,
  CHARACTER_OBSERVATION_MAX_VISIBLE_POIS,
} from '../../runtime/character-control-protocol';
import type { GameplayEntity } from '../gameplay/entity-store';
import { CharacterGoalRuntime } from './character-goal-runtime';
import {
  CHARACTER_MAX_DIALOGUE_TEXT,
  CHARACTER_MAX_EVENTS,
  CHARACTER_MAX_MEMORY_TEXT,
  CHARACTER_MAX_SPEECH_TEXT,
  CHARACTER_MAX_TARGETS,
  createCharacterInventory,
  type CharacterPositionTuple as Position,
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

const DANGER_SECONDS = 3;
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
  private readonly goals: CharacterGoalRuntime;
  private sequence = 0;

  constructor(private readonly options: Options) {
    this.goals = new CharacterGoalRuntime(options, {
      record: (record, type, fields) => this.record(record, type, fields),
      reference: (record, kind, targetId) => this.reference(record, kind, targetId),
      isVisible: (record, targetId) => this.isVisible(record, targetId),
      requireEntity: (entityId) => this.requireEntity(entityId),
    });
  }

  retainedActionIds(): string[] {
    return [...this.records.values()].flatMap((record) => (record.actionId ? [record.actionId] : []));
  }

  validateRegistration(profile: CharacterProfile, homePosition: readonly number[]): void {
    validateCharacterProfile(profile);
    position(homePosition, 'Character home position');
  }

  register(entityId: string, profile: CharacterProfile, homePosition: readonly number[]): CharacterState {
    if (this.records.has(entityId)) throw new Error(`Character already exists: ${entityId}`);
    validateCharacterProfile(profile);
    const entity = this.requireEntity(entityId);
    const home = position(homePosition, 'Character home position');
    const record: CharacterRecord = {
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
    this.options.interruptAction(entityId, reason);
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
    if (request.kind === 'list')
      return {
        kind: 'list',
        characters: [...this.records.values()]
          .sort((a, b) => a.entityId.localeCompare(b.entityId))
          .map((record) => this.state(record)),
      };
    if (!['inspect', 'observe', 'dialogue', 'memory', 'intent'].includes(request.kind))
      throw new TypeError('Character request kind is invalid.');
    const record = this.requireRecord(request.entityId);
    if (request.kind === 'inspect') return { kind: 'state', character: this.state(record) };
    if (request.kind === 'observe')
      return { kind: 'observation', observation: this.observe(record, request.sinceCursor) };
    if (request.kind === 'dialogue') {
      this.requireActive(record);
      return {
        kind: 'dialogue',
        event: this.record(record, 'dialogue-heard', {
          text: text(request.text, 'Dialogue', CHARACTER_MAX_DIALOGUE_TEXT),
        }),
      };
    }
    if (request.kind === 'memory') return { kind: 'memory', character: this.updateMemory(record, request) };
    return { kind: 'intent', accepted: true, character: this.applyIntent(record, request) };
  }

  recordAttacked(entityId: string, attackerId: string): void {
    const record = this.records.get(entityId);
    if (!record || record.lifecycle !== 'active') return;
    const target = this.reference(record, 'entity', attackerId);
    if (record.currentGoal.status === 'active') record.suspendedGoal = cloneGoalState(record.currentGoal);
    this.options.interruptAction(entityId, 'danger');
    record.actionId = undefined;
    record.currentGoal = { ...record.currentGoal, status: 'suspended', reason: 'danger' };
    record.revision += 1;
    record.dangerSecondsRemaining = DANGER_SECONDS;
    record.lastBehavior = this.options.actor(entityId)?.behavior ?? 'flee';
    this.record(record, 'attacked', { target });
    this.options.changed();
  }

  advance(seconds: number): void {
    for (const record of this.records.values()) this.goals.advance(record, seconds);
  }

  snapshot(): CharacterSnapshot {
    return {
      version: 1,
      sequence: this.sequence,
      characters: [...this.records.values()].map((record) => ({
        ...this.stateFields(record),
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
      })),
    };
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
      snapshot.version !== 1 ||
      !Number.isSafeInteger(snapshot.sequence) ||
      !Array.isArray(snapshot.characters)
    )
      throw new TypeError('Character snapshot header is invalid.');
    const next = new Map<string, CharacterRecord>();
    for (const value of snapshot.characters) {
      validateCharacterSnapshotRecord(value);
      validateCharacterActionLink(value, value.actionId ? this.options.action(value.actionId) : null);
      if (
        next.has(value.entityId) ||
        (value.lifecycle === 'active' && !this.options.actor(value.entityId)) ||
        (value.lifecycle === 'deceased' && this.options.actor(value.entityId))
      )
        throw new TypeError('Character snapshot actor lifecycle is invalid or duplicated.');
      next.set(value.entityId, {
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
      });
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
    if (request.goal.kind !== 'idle' && !this.options.canStartAction())
      throw new RangeError('Action sequence is exhausted.');
    if (!retainsAction) this.options.interruptAction(record.entityId, 'goal-replaced');
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
    if (!retainsAction) this.goals.start(record);
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

  private observe(record: CharacterRecord, sinceCursor = record.eventCursor): CharacterObservation {
    if (!Number.isSafeInteger(sinceCursor) || sinceCursor < 0 || sinceCursor > record.eventCursor)
      throw new TypeError('Character event cursor is invalid.');
    if (record.lifecycle === 'deceased') {
      const page = this.eventPage(record, sinceCursor);
      return {
        character: this.state(record),
        self: { position: [...record.lastPosition], health: 0 },
        visibleEntities: [],
        visiblePois: [],
        ...page,
      };
    }
    const perception = this.options.observe(record.entityId);
    const observedCharacter = this.requireEntity(record.entityId);
    const protectedTargets = this.protectedTargets(record, perception);
    const visibleEntities = perception.visibleEntities
      .slice(0, CHARACTER_OBSERVATION_MAX_VISIBLE_ENTITIES)
      .flatMap((entry) => {
        const entity = this.options.entities.get(entry.entityId);
        if (!entity) return [];
        return [
          {
            target: this.reference(record, 'entity', entity.id, protectedTargets),
            type: entity.type,
            distance: entry.distance,
            position: [...entity.position] as Position,
            ...(entity.stack ? { stack: { ...entity.stack } } : {}),
          },
        ];
      });
    const visiblePois = perception.pois.slice(0, CHARACTER_OBSERVATION_MAX_VISIBLE_POIS).flatMap((entry) => {
      const poi = this.options.poi(entry.poiId);
      return poi
        ? [
            {
              target: this.reference(record, 'poi', poi.id, protectedTargets),
              type: poi.kind,
              position: [...poi.position] as Position,
              distance: entry.distance,
            },
          ]
        : [];
    });
    const page = this.eventPage(record, sinceCursor);
    const gap =
      Boolean(page.gap) ||
      perception.visibleEntities.length > CHARACTER_OBSERVATION_MAX_VISIBLE_ENTITIES ||
      perception.pois.length > CHARACTER_OBSERVATION_MAX_VISIBLE_POIS;
    return {
      character: this.state(record),
      self: {
        position: [...observedCharacter.position],
        ...(observedCharacter.health === undefined ? {} : { health: observedCharacter.health }),
      },
      visibleEntities,
      visiblePois,
      events: page.events,
      cursor: page.cursor,
      ...(gap ? { gap: true } : {}),
    };
  }

  private resolveVisibleTarget(record: CharacterRecord, target: CharacterTargetRef, kind: TargetBinding['kind']) {
    const binding = record.targets.find((candidate) => candidate.ref === target.ref);
    if (
      !binding ||
      binding.kind !== kind ||
      binding.revision !== target.revision ||
      !this.isVisible(record, binding.targetId)
    )
      throw new CharacterControlFailure('CHARACTER_TARGET_UNAVAILABLE', 'Character target is unavailable.');
    return binding.targetId;
  }

  private isVisible(record: CharacterRecord, targetId: string): boolean {
    const observed = this.options.observe(record.entityId);
    return (
      observed.visibleEntities.some((entry) => entry.entityId === targetId) ||
      observed.pois.some((entry) => entry.poiId === targetId)
    );
  }

  private protectedTargets(record: CharacterRecord, perception = this.options.observe(record.entityId)) {
    const protectedTargets = new Set<string>();
    for (const entry of perception.visibleEntities.slice(0, CHARACTER_OBSERVATION_MAX_VISIBLE_ENTITIES))
      if (this.options.entities.get(entry.entityId)) protectedTargets.add(`entity:${entry.entityId}`);
    for (const entry of perception.pois.slice(0, CHARACTER_OBSERVATION_MAX_VISIBLE_POIS))
      if (this.options.poi(entry.poiId)) protectedTargets.add(`poi:${entry.poiId}`);
    if (record.executionTargetId) protectedTargets.add(`entity:${record.executionTargetId}`);
    return protectedTargets;
  }

  private reference(
    record: CharacterRecord,
    kind: TargetBinding['kind'],
    targetId: string,
    protectedTargets?: ReadonlySet<string>,
  ): CharacterTargetRef {
    let binding = record.targets.find((candidate) => candidate.kind === kind && candidate.targetId === targetId);
    if (!binding) {
      if (record.targetSequence >= Number.MAX_SAFE_INTEGER)
        throw new TypeError('Character target sequence is exhausted.');
      if (record.targets.length >= CHARACTER_MAX_TARGETS) {
        const retainedTargets = protectedTargets ?? this.protectedTargets(record);
        const evicted = record.targets.findIndex(
          (candidate) => !retainedTargets.has(`${candidate.kind}:${candidate.targetId}`),
        );
        record.targets.splice(evicted < 0 ? 0 : evicted, 1);
      }
      binding = { kind, targetId, ref: `target-${++record.targetSequence}`, revision: 1 };
      record.targets.push(binding);
      this.options.changed();
    }
    return { kind, ref: binding.ref, revision: binding.revision };
  }

  private record(
    record: CharacterRecord,
    type: CharacterEvent['type'],
    fields: Pick<CharacterEvent, 'text' | 'target' | 'reason'> = {},
  ): CharacterEvent {
    const event = { cursor: ++record.eventCursor, at: this.options.now(), type, ...fields };
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

  private eventPage(record: CharacterRecord, sinceCursor: number) {
    const firstCursor = record.events[0]?.cursor ?? record.eventCursor + 1;
    const events = record.events
      .filter((event) => event.cursor > sinceCursor)
      .slice(0, CHARACTER_OBSERVATION_MAX_EVENTS)
      .map((event) => ({ ...event, ...(event.target ? { target: { ...event.target } } : {}) }));
    return {
      events,
      cursor: events.at(-1)?.cursor ?? sinceCursor,
      ...(sinceCursor < firstCursor - 1 ? { gap: true } : {}),
    };
  }

  private requireEntity(entityId: string): GameplayEntity {
    const entity = this.options.entities.get(entityId);
    if (!entity || entity.type !== 'npc' || entity.archetype !== 'settler')
      throw new CharacterControlFailure('CHARACTER_UNAVAILABLE', 'Character is unavailable.');
    return entity;
  }
}

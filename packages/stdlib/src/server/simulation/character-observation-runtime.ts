import type {
  CharacterObservation,
  CharacterState,
  CharacterTargetRef,
} from '../../runtime/character-control-protocol';
import {
  CHARACTER_OBSERVATION_MAX_EVENTS,
  CHARACTER_OBSERVATION_MAX_VISIBLE_ENTITIES,
  CHARACTER_OBSERVATION_MAX_VISIBLE_POIS,
} from '../../runtime/character-control-protocol';
import type { GameplayEntity } from '../gameplay/entity-store';
import {
  CHARACTER_MAX_TARGETS,
  type CharacterRecord,
  type CharacterRuntimeOptions as Options,
  type CharacterPositionTuple as Position,
  type CharacterTargetBinding as TargetBinding,
} from './character-runtime-types';
/** Authoritative local perception, opaque target references and bounded event pages. */
export class CharacterObservationRuntime {
  constructor(
    private readonly options: Options,
    private readonly state: (record: CharacterRecord) => CharacterState,
    private readonly requireEntity: (entityId: string) => GameplayEntity,
  ) {}
  observe(record: CharacterRecord, sinceCursor = 0, throughCursor = record.eventCursor): CharacterObservation {
    if (
      !Number.isSafeInteger(sinceCursor) ||
      sinceCursor < 0 ||
      sinceCursor > record.eventCursor ||
      !Number.isSafeInteger(throughCursor) ||
      throughCursor < sinceCursor ||
      throughCursor > record.eventCursor
    )
      throw new TypeError('Character event cursor is invalid.');
    if (record.lifecycle === 'deceased') {
      const page = this.eventPage(record, sinceCursor, throughCursor);
      return {
        character: this.state(record),
        self: { position: [...record.lastPosition], health: 0 },
        visibleEntities: [],
        visiblePois: [],
        worldTime: this.options.worldTime(),
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
    const page = this.eventPage(record, sinceCursor, throughCursor);
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
      eventCoverage: page.eventCoverage,
      worldTime: this.options.worldTime(),
      ...(gap ? { gap: true } : {}),
    };
  }

  isVisible(record: CharacterRecord, kind: TargetBinding['kind'], targetId: string): boolean {
    const observed = this.options.observe(record.entityId);
    return kind === 'entity'
      ? observed.visibleEntities.some((entry) => entry.entityId === targetId)
      : observed.pois.some((entry) => entry.poiId === targetId);
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

  reference(
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

  private eventPage(record: CharacterRecord, sinceCursor: number, throughCursor: number) {
    const firstCursor = record.events[0]?.cursor ?? record.eventCursor + 1;
    const events = record.events
      .filter((event) => event.cursor > sinceCursor && event.cursor <= throughCursor)
      .slice(0, CHARACTER_OBSERVATION_MAX_EVENTS)
      .map((event) => ({ ...event, ...(event.target ? { target: { ...event.target } } : {}) }));
    const returnedThrough = events.at(-1)?.cursor ?? sinceCursor;
    const lostFrom = sinceCursor + 1;
    const lostTo = Math.min(throughCursor, firstCursor - 1);
    return {
      events,
      cursor: returnedThrough,
      ...(sinceCursor < firstCursor - 1 ? { gap: true } : {}),
      eventCoverage: {
        requestedAfter: sinceCursor,
        through: throughCursor,
        returnedThrough,
        hasMore: returnedThrough < throughCursor,
        ...(lostFrom <= lostTo ? { lostRange: { from: lostFrom, to: lostTo } } : {}),
      },
    };
  }
}

import { isSolid } from '../../world/voxel';
import type { ActorArchetype, EntityStore, GameplayEntity } from '../gameplay/entity-store';
import type { Poi, PoiRegistry } from './poi-registry';

export type ObservedEntity = {
  entityId: string;
  type: GameplayEntity['type'];
  archetype?: ActorArchetype;
  distance: number;
};
export type ObservedPoi = { poiId: string; kind: Poi['kind']; distance: number };
export type ObservationEvent = {
  type:
    | 'entity-seen'
    | 'threat-seen'
    | 'food-seen'
    | 'poi-seen'
    | 'attacked'
    | 'action-completed'
    | 'action-failed'
    | 'action-interrupted';
  subjectId: string;
  distance?: number;
};
export type PerceptionSnapshot = {
  observerId: string;
  visibleEntities: ObservedEntity[];
  threats: ObservedEntity[];
  food: ObservedEntity[];
  pois: ObservedPoi[];
  observations: ObservationEvent[];
  candidateCount: number;
  lineOfSightChecks: number;
};

type Options = {
  entities: EntityStore;
  pois: PoiRegistry;
  getVoxel: (x: number, y: number, z: number) => number;
  isPlayerAlive: (id: string) => boolean;
};

const distance = (left: readonly number[], right: readonly number[]) =>
  Math.sqrt(left.reduce((sum, value, index) => sum + (value - right[index]) ** 2, 0));
const entityDistance = (left: GameplayEntity, right: GameplayEntity) => {
  const verticalAllowance = left.type === 'player' || right.type === 'player' ? 1.6 : 0;
  const vertical = Math.max(0, Math.abs(left.position[1] - right.position[1]) - verticalAllowance);
  return Math.hypot(left.position[0] - right.position[0], vertical, left.position[2] - right.position[2]);
};

export class PerceptionRuntime {
  private readonly recent = new Map<string, ObservationEvent[]>();
  private checkCount = 0;

  constructor(private readonly options: Options) {}

  observe(observerId: string, range: number): PerceptionSnapshot {
    const observer = this.options.entities.get(observerId);
    if (!observer) throw new RangeError(`Unknown observer: ${observerId}`);
    if (!Number.isFinite(range) || range <= 0) throw new TypeError('Perception range must be positive.');
    const candidates = this.options.entities
      .queryNearby(observer.position, range)
      .filter((candidate) => candidate.id !== observerId);
    let lineOfSightChecks = 0;
    const visibleEntities = candidates
      .filter((candidate) => {
        lineOfSightChecks += 1;
        return this.hasLineOfSight(observer.position, candidate.position);
      })
      .map((candidate) => this.observed(observer, candidate))
      .sort((left, right) => left.distance - right.distance || left.entityId.localeCompare(right.entityId));
    const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
    const threats = visibleEntities.filter((candidate) => this.isThreat(observer, byId.get(candidate.entityId)!));
    const food = visibleEntities.filter((candidate) => this.isFood(observer, byId.get(candidate.entityId)!));
    const pois = this.options.pois
      .queryNearby(observer.position, range)
      .filter((poi) => {
        lineOfSightChecks += 1;
        return this.hasLineOfSight(observer.position, poi.position);
      })
      .map((poi) => ({ poiId: poi.id, kind: poi.kind, distance: distance(observer.position, poi.position) }))
      .sort((left, right) => left.distance - right.distance || left.poiId.localeCompare(right.poiId));
    this.checkCount += lineOfSightChecks;
    const observations: ObservationEvent[] = [
      ...visibleEntities.map((entity) => ({
        type: 'entity-seen' as const,
        subjectId: entity.entityId,
        distance: entity.distance,
      })),
      ...threats.map((entity) => ({
        type: 'threat-seen' as const,
        subjectId: entity.entityId,
        distance: entity.distance,
      })),
      ...food.map((entity) => ({ type: 'food-seen' as const, subjectId: entity.entityId, distance: entity.distance })),
      ...pois.map((poi) => ({ type: 'poi-seen' as const, subjectId: poi.poiId, distance: poi.distance })),
      ...(this.recent.get(observerId) ?? []),
    ];
    this.recent.delete(observerId);
    return {
      observerId,
      visibleEntities,
      threats,
      food,
      pois,
      observations,
      candidateCount: candidates.length,
      lineOfSightChecks,
    };
  }

  record(observerId: string, event: ObservationEvent): void {
    const events = this.recent.get(observerId) ?? [];
    events.push({ ...event });
    this.recent.set(observerId, events.slice(-16));
  }

  get totalLineOfSightChecks(): number {
    return this.checkCount;
  }

  private observed(observer: GameplayEntity, candidate: GameplayEntity): ObservedEntity {
    return {
      entityId: candidate.id,
      type: candidate.type,
      ...(candidate.archetype ? { archetype: candidate.archetype } : {}),
      distance: entityDistance(observer, candidate),
    };
  }

  private isThreat(observer: GameplayEntity, candidate: GameplayEntity): boolean {
    if (observer.archetype === 'night-stalker')
      return candidate.type === 'player' && this.options.isPlayerAlive(candidate.id);
    return candidate.archetype === 'night-stalker';
  }

  private isFood(observer: GameplayEntity, candidate: GameplayEntity): boolean {
    return observer.archetype === 'grazer' && candidate.type === 'world-item' && candidate.stack?.itemId === 'berry';
  }

  private hasLineOfSight(from: readonly number[], to: readonly number[]): boolean {
    const length = distance(from, to);
    const samples = Math.max(1, Math.ceil(length / 0.25));
    for (let index = 1; index < samples; index += 1) {
      const ratio = index / samples;
      const x = Math.floor(from[0] + (to[0] - from[0]) * ratio);
      const y = Math.floor(from[1] + (to[1] - from[1]) * ratio);
      const z = Math.floor(from[2] + (to[2] - from[2]) * ratio);
      if (isSolid(this.options.getVoxel(x, y, z))) return false;
    }
    return true;
  }
}

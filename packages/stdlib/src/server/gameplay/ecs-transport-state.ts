import { cloneItemStack } from './item-instance';
import { addComponent, type World, type EntityId } from 'bitecs';
import type { ItemDefinitionRegistry } from './item-registry';
import { isActorEntityType } from './ecs-actor-state';
import type { EcsOwnedEntity, EcsPosition, EntityLifetimeReference } from './ecs-entity-owner';
import {
  validateTransportComponentV1,
  type TransportComponentV1,
  type TransportDefinitionRegistryV1,
  type TransportStateV2,
} from './modules/transport-model';

export type TransportSpawnState = Omit<TransportComponentV1, 'version' | 'entityId' | 'revision'>;
export type TransportStateCodec = Readonly<{
  items: ItemDefinitionRegistry;
  definitions: TransportDefinitionRegistryV1;
  create(entityId: string, state: TransportSpawnState): TransportComponentV1;
  decode(raw: unknown, entityId?: string): TransportComponentV1;
}>;

type EntityBindings = Readonly<{
  epoch: number;
  get(id: string): EcsOwnedEntity | null;
  require(id: string): EntityId;
  resolve(reference: EntityLifetimeReference): EcsOwnedEntity | null;
  reference(id: string): EntityLifetimeReference | null;
  query(): readonly EcsOwnedEntity[];
}>;

/** World-local component storage; no transform, velocity or duplicate lifetime owner. */
export class EcsTransportStateOwner {
  readonly component = { value: [] as Array<TransportComponentV1 | undefined> };
  constructor(
    private readonly world: World,
    private readonly codec: TransportStateCodec | undefined,
    private readonly bindings: EntityBindings,
  ) {}

  prepare(entityId: string, state: TransportSpawnState): TransportComponentV1 {
    return prepareTransportCreation(
      this.codec,
      entityId,
      state,
      this.bindings.query().map((entity) => this.snapshot(entity.id)),
      this.bindings.resolve,
      this.bindings.epoch,
    );
  }
  prepareRestored(entityId: string, state: unknown): TransportComponentV1 {
    if (!this.codec) throw new TypeError('Transport restore requires a configured codec.');
    return this.codec.decode(state, entityId);
  }
  prepareReplacement(entityId: string, raw: unknown): TransportComponentV1 {
    const current = this.snapshot(entityId);
    const candidate = this.prepareRestored(entityId, raw);
    if (current.revision >= Number.MAX_SAFE_INTEGER || candidate.revision !== current.revision + 1)
      throw new TypeError('Prepared transport revision must advance exactly once.');
    if (candidate.definitionId !== current.definitionId)
      throw new TypeError('A transport definition cannot change within one entity lifetime.');
    return candidate;
  }
  replace(eid: EntityId, state: TransportComponentV1): void {
    this.component.value[eid] = state;
  }
  initialize(eid: EntityId, state: TransportComponentV1): void {
    addComponent(this.world, eid, this.component);
    this.component.value[eid] = state;
  }
  snapshot(id: string): TransportComponentV1 {
    const state = this.component.value[this.bindings.require(id)];
    if (this.bindings.get(id)?.type !== 'transport' || !state)
      throw new TypeError('Entity has no transport component.');
    return state;
  }
  project(reference: EntityLifetimeReference): TransportStateV2 | null {
    const entity = this.bindings.resolve(reference);
    if (entity?.type !== 'transport') return null;
    const state = this.snapshot(entity.id);
    validateTransportRelations([state], this.bindings.resolve, this.bindings.epoch);
    return projectTransportState(entity, this.bindings.reference(entity.id)!, state);
  }
  validateRelations(): void {
    validateTransportRelations(
      this.bindings.query().map((entity) => this.snapshot(entity.id)),
      this.bindings.resolve,
      this.bindings.epoch,
    );
  }
  clear(eid: EntityId): void {
    this.component.value[eid] = undefined;
  }
}

export function createTransportStateCodec(
  definitions: TransportDefinitionRegistryV1,
  items: ItemDefinitionRegistry,
): TransportStateCodec {
  const decode = (raw: unknown, entityId?: string): TransportComponentV1 => {
    const component = validateTransportComponentV1(raw, definitions);
    if (entityId !== undefined && component.entityId !== entityId)
      throw new TypeError('Transport component belongs to a different entity.');
    const inventory = Object.freeze(
      component.inventory.map((slot) => {
        if (slot === null) return null;
        const normalized = items.normalizeStack(slot);
        if (normalized.count > items.require(normalized.itemId).stackLimit)
          throw new TypeError('Transport inventory slot exceeds its registered stack limit.');
        return Object.freeze(cloneItemStack(normalized));
      }),
    );
    return Object.freeze({ ...component, inventory });
  };
  return Object.freeze({
    items,
    definitions,
    decode,
    create: (entityId, state) => {
      if (
        !state ||
        typeof state !== 'object' ||
        Array.isArray(state) ||
        Object.keys(state).some(
          (key) => !['definitionId', 'yaw', 'routeCursor', 'rider', 'fuel', 'inventory'].includes(key),
        )
      )
        throw new TypeError('Transport creation fields are invalid.');
      return decode({ ...state, version: 1, entityId, revision: 0 }, entityId);
    },
  });
}

export function collectTransportSnapshots(raw: unknown): Map<string, TransportComponentV1> {
  if (!Array.isArray(raw) || raw.length > 4096) throw new TypeError('Transport component snapshots are invalid.');
  const result = new Map<string, TransportComponentV1>();
  for (const entry of raw) {
    if (!entry || typeof entry.entityId !== 'string' || !entry.entityId.trim() || result.has(entry.entityId))
      throw new TypeError('Transport component snapshots are invalid or duplicated.');
    result.set(entry.entityId, entry);
  }
  return result;
}

export function validateTransportRelations(
  components: readonly TransportComponentV1[],
  resolve: (reference: EntityLifetimeReference) => EcsOwnedEntity | null,
  epoch: number,
): void {
  const riders = new Set<string>();
  for (const component of components) {
    if (!component.rider) continue;
    const rider = resolve({ ...component.rider, epoch });
    if (!rider || !isActorEntityType(rider.type) || rider.health === 0)
      throw new TypeError('Transport rider must reference a live actor lifetime.');
    if (riders.has(component.rider.entityId)) throw new TypeError('One rider cannot occupy multiple transports.');
    riders.add(component.rider.entityId);
  }
}

export function prepareTransportCreation(
  codec: TransportStateCodec | undefined,
  entityId: string,
  state: TransportSpawnState,
  existing: readonly TransportComponentV1[],
  resolve: (reference: EntityLifetimeReference) => EcsOwnedEntity | null,
  epoch: number,
): TransportComponentV1 {
  if (!codec) throw new TypeError('Transport creation requires a configured codec.');
  const component = codec.create(entityId, state);
  validateTransportRelations([...existing, component], resolve, epoch);
  return component;
}

export function projectTransportState(
  entity: EcsOwnedEntity,
  reference: EntityLifetimeReference,
  state: TransportComponentV1,
): TransportStateV2 {
  return Object.freeze({
    version: 2,
    reference,
    definitionId: state.definitionId,
    pose: Object.freeze({ position: Object.freeze([...entity.position] as EcsPosition), yaw: state.yaw }),
    velocity: Object.freeze([...(entity.physicsVelocity ?? [0, 0, 0])] as EcsPosition),
    routeCursor: state.routeCursor,
    rider: state.rider ? Object.freeze({ ...state.rider, epoch: reference.epoch }) : null,
    fuel: state.fuel,
    inventory: state.inventory,
  });
}

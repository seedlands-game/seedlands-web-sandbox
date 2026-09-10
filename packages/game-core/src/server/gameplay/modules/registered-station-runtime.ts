import {
  FURNACE_WORLD_COMPONENT,
  FURNACE_SYSTEM,
  FURNACE_RESOURCE,
  FURNACE_PARTITIONS,
  FURNACE_PARTITION_SIZE,
  FURNACE_ADVANCE_OPERATION,
  furnaceActive,
  furnaceWorldAddress,
  furnaceSeconds,
  buildFurnaceWorldCandidate,
} from './furnace-world-model';
import type { WorldComposition, ModuleInvocationValue } from '../../composition/contracts';
import { assertActorResourceExecution } from '../../composition/secondary-resource-authorization';
import type {
  RegisteredStatePort,
  ModStateAddress,
  ObservedModState,
  RegisteredCommitContext,
  PreparedRegisteredCommit,
} from '../../composition/operation-contracts';
import type { EntityStore } from '../entity-store';
import type { GameplayContent } from '../gameplay-content';
import type { AutonomyRuntime } from '../../simulation/autonomy-runtime';
import { isActorEntityType } from '../ecs-actor-state';
import { prepareEntityMutation, prepareEntityMutationSeries } from '../prepared-entity-mutation';
import { positionsInRange } from '../gameplay-geometry';
import { traceVoxelRay } from '../voxel-ray';
import {
  STATION_ACTOR_COMPONENT,
  STATION_INSTANCE_COMPONENT,
  STATION_ACTOR_RESOURCE,
  STATION_RESOURCE,
  STATION_TRANSFER_OPERATION,
  STATION_CRAFT_OPERATION,
  stationActorAddress,
  stationInstanceAddress,
  validateStationActor,
  validateStationProjection,
  buildStationActionCandidate,
} from './station-action-model';
import { buildInventoryPointerCandidate, type InventoryPointerInputV1 } from './inventory-pointer-model';

type Options = Readonly<{
  composition: WorldComposition;
  entities: EntityStore;
  content: GameplayContent;
  simulation(): AutonomyRuntime;
  revision(): number;
  assertCanChange(): void;
  changed(inventoryOperation: boolean): void;
  getVoxel(position: [number, number, number]): number | undefined;
}>;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** One state participant prepares actor and station changes against their shared ECS owner. */
export class RegisteredStationRuntime {
  readonly state: RegisteredStatePort;
  private sequence = 0;
  private readonly receipts = new Map<number, string>();
  constructor(private readonly options: Options) {
    this.state = {
      read: (address) => {
        const value = this.project(address);
        if (this.sequence === Number.MAX_SAFE_INTEGER) throw new RangeError('Station observation capacity exhausted.');
        const revision = ++this.sequence;
        this.receipts.set(revision, this.signature(address, value));
        while (this.receipts.size > 128) this.receipts.delete(this.receipts.keys().next().value!);
        return { revision, value };
      },
      commit: () => ({ ok: false, reason: 'Station actions require prepared commit.' }),
      prepareCommit: (observed, writes, execution) => {
        if (writes.length)
          return { ok: false, code: 'STATION_WRITE_FORBIDDEN', reason: 'Station actions return candidates.' };
        this.validateObserved(observed);
        return this.prepare(observed, execution);
      },
    };
  }
  private actor(id: string) {
    const entity = this.options.entities.get(id);
    if (!entity || !isActorEntityType(entity.type)) throw new Error('unknown-actor');
    const actor = this.options.entities.actorStateAccess(id);
    return validateStationActor(
      {
        version: 1,
        reference: this.options.entities.createReference(id),
        kind: entity.type,
        slots: actor.inventory.snapshot(),
        equipment: { selectedSlot: actor.selectedSlot, hotbarSize: actor.hotbarSize },
        lifecycle: actor.lifecycle,
        needs: { hunger: actor.hunger, maxHunger: actor.maxHunger, meaning: actor.hungerMeaning },
        inventoryRevision: actor.inventoryRevision,
        cursor: actor.inventoryCursor,
        mode: actor.mode,
      },
      this.options.content,
    );
  }
  private station(id: string) {
    const entity = this.options.entities.get(id);
    if (!entity || entity.type !== 'station') throw new Error('unknown-station');
    return validateStationProjection(
      {
        version: 1,
        reference: this.options.entities.createReference(id),
        position: entity.position,
        component: this.options.entities.stationSnapshot(id),
      },
      this.options.content,
    );
  }
  private activeFurnaces() {
    const values = this.options.entities
      .queryStations()
      .filter((entity) => furnaceActive(this.options.entities.stationSnapshot(entity.id)!, this.options.content))
      .map((entity) => this.station(entity.id))
      .sort((a, b) =>
        a.reference.entityId < b.reference.entityId ? -1 : a.reference.entityId > b.reference.entityId ? 1 : 0,
      );
    if (values.length > FURNACE_PARTITIONS * FURNACE_PARTITION_SIZE)
      throw new RangeError('Active furnace capacity exceeded.');
    return values;
  }
  private project(address: ModStateAddress): ModuleInvocationValue {
    if (address.componentId === FURNACE_WORLD_COMPONENT) {
      if (
        address.target.kind !== 'world' ||
        !Number.isSafeInteger(address.partition) ||
        address.partition! < 0 ||
        address.partition! >= FURNACE_PARTITIONS
      )
        throw new TypeError('Invalid furnace partition address.');
      return {
        version: 1,
        partition: address.partition!,
        entries: this.activeFurnaces().slice(
          address.partition! * FURNACE_PARTITION_SIZE,
          (address.partition! + 1) * FURNACE_PARTITION_SIZE,
        ),
      };
    }
    if (address.target.kind !== 'entity' || address.partition !== undefined)
      throw new TypeError('Invalid station address.');
    if (address.componentId === STATION_ACTOR_COMPONENT) return this.actor(address.target.entityId);
    if (address.componentId === STATION_INSTANCE_COMPONENT) return this.station(address.target.entityId);
    throw new TypeError('Invalid station component.');
  }
  private signature(address: ModStateAddress, value = this.project(address)) {
    return JSON.stringify([this.options.revision(), address, value]);
  }
  private validateObserved(observed: readonly ObservedModState[]) {
    const seen = new Set<string>();
    for (const entry of observed) {
      const key = JSON.stringify(entry.address);
      if (seen.has(key) || this.receipts.get(entry.revision) !== this.signature(entry.address))
        throw new Error('Station observation is stale.');
      seen.add(key);
    }
  }
  private prepare(observed: readonly ObservedModState[], execution: RegisteredCommitContext): PreparedRegisteredCommit {
    if (execution.operationId === FURNACE_ADVANCE_OPERATION) return this.prepareFurnaces(observed, execution);
    const kind =
      execution.operationId === STATION_TRANSFER_OPERATION
        ? 'transfer'
        : execution.operationId === STATION_CRAFT_OPERATION
          ? 'craft'
          : null;
    const { context } = execution;
    if (
      !kind ||
      context.kind !== 'actor' ||
      context.target.kind !== 'entity' ||
      execution.resource !== STATION_RESOURCE
    )
      throw new TypeError('Invalid station execution.');
    const actorId = context.originalActorId,
      stationId = context.target.entityId;
    const expected = [stationActorAddress(actorId), stationInstanceAddress(stationId)];
    if (observed.length !== 2 || expected.some((address) => !observed.some((entry) => same(entry.address, address))))
      throw new TypeError('Station observation scope mismatch.');
    const authorize = () =>
      assertActorResourceExecution(this.options.composition, execution.authorizer, context, STATION_ACTOR_RESOURCE);
    authorize();
    const actor = this.actor(actorId),
      station = this.station(stationId);
    if (
      execution.effectiveInput !== null &&
      typeof execution.effectiveInput === 'object' &&
      !Array.isArray(execution.effectiveInput) &&
      Object.hasOwn(execution.effectiveInput, 'command')
    )
      return this.preparePointer(observed, execution, actor, station, authorize);
    const candidate = buildStationActionCandidate(this.options.content, {
      kind,
      actor,
      station,
      input: execution.effectiveInput,
    });
    if (!same(candidate, execution.candidateValue))
      throw new TypeError('Station candidate differs from authoritative state.');
    const geometry = () => {
      const current = this.options.entities.get(actorId),
        target = this.options.entities.get(stationId);
      if (
        !current ||
        !target ||
        !this.options.entities.resolveReference(candidate.actorReference) ||
        !this.options.entities.resolveReference(candidate.stationReference)
      )
        throw new Error('stale-station-reference');
      const position = [...target.position] as [number, number, number];
      if (this.options.getVoxel(position) !== candidate.station.voxel) throw new Error('station-voxel-mismatch');
      const eye: [number, number, number] = [current.position[0], current.position[1] + 1.6, current.position[2]],
        center: [number, number, number] = [position[0] + 0.5, position[1] + 0.5, position[2] + 0.5];
      if (!positionsInRange(eye, center, 4.5)) throw new Error('out-of-range');
      const sight = traceVoxelRay(eye, center, (x, y, z) => this.options.getVoxel([x, y, z]));
      if (sight !== 'clear') throw new Error(sight === 'unavailable' ? 'chunk-unavailable' : 'blocked');
    };
    geometry();
    if (
      furnaceActive(candidate.station, this.options.content) &&
      !furnaceActive(station.component, this.options.content) &&
      this.activeFurnaces().length >= FURNACE_PARTITIONS * FURNACE_PARTITION_SIZE
    )
      throw new RangeError('Active furnace capacity exceeded.');
    this.options.assertCanChange();
    const components = this.options.entities.actorComponentSnapshot(actorId);
    const changedTool = !same(actor.slots[actor.equipment.selectedSlot], candidate.slots[actor.equipment.selectedSlot]);
    const cancellation = changedTool
      ? this.options.simulation().prepareCancellation([actorId], 'slot-changed')
      : undefined;
    const mutation = prepareEntityMutation(this.options.entities, {
      actors: [
        {
          reference: candidate.actorReference,
          health: this.options.entities.actorStateAccess(actorId).health,
          components: {
            ...components,
            inventory: [...candidate.slots],
            ...(changedTool && components.player ? { player: { ...components.player, breakAction: null } } : {}),
          },
        },
      ],
      stations: [{ reference: candidate.stationReference, snapshot: candidate.station }],
    });
    const revision = this.options.revision();
    let used = false,
      validated = false;
    return {
      ok: true,
      revision: revision + 1,
      value: candidate.result,
      validate: () => {
        validated = false;
        if (used || this.options.revision() !== revision) throw new Error('Prepared station action is stale.');
        this.validateObserved(observed);
        authorize();
        geometry();
        this.options.assertCanChange();
        mutation.validate();
        cancellation?.validate();
        validated = true;
      },
      apply: () => {
        if (used || !validated) throw new Error('Station commit requires validation.');
        mutation.apply();
        cancellation?.apply();
        this.options.changed(true);
        used = true;
      },
    };
  }
  private preparePointer(
    observed: readonly ObservedModState[],
    execution: RegisteredCommitContext,
    actor: ReturnType<RegisteredStationRuntime['actor']>,
    station: ReturnType<RegisteredStationRuntime['station']>,
    authorize: () => void,
  ): PreparedRegisteredCommit {
    const candidate = buildInventoryPointerCandidate(this.options.content, {
      actor,
      station,
      input: execution.effectiveInput,
    });
    if (!same(candidate, execution.candidateValue))
      throw new TypeError('Station pointer candidate differs from authoritative state.');
    const command = (execution.effectiveInput as unknown as InventoryPointerInputV1).command;
    if ((command.kind === 'craft') !== (execution.operationId === STATION_CRAFT_OPERATION))
      throw new TypeError('Station pointer operation kind is invalid.');
    const actorId = actor.reference.entityId;
    const stationId = station.reference.entityId;
    const geometry = () => {
      const current = this.options.entities.get(actorId),
        target = this.options.entities.get(stationId);
      if (
        !current ||
        !target ||
        !this.options.entities.resolveReference(candidate.actorReference) ||
        !candidate.stationReference ||
        !this.options.entities.resolveReference(candidate.stationReference)
      )
        throw new Error('stale-station-reference');
      const position = [...target.position] as [number, number, number];
      if (this.options.getVoxel(position) !== station.component.voxel) throw new Error('station-voxel-mismatch');
      const eye: [number, number, number] = [current.position[0], current.position[1] + 1.6, current.position[2]],
        center: [number, number, number] = [position[0] + 0.5, position[1] + 0.5, position[2] + 0.5];
      if (!positionsInRange(eye, center, 4.5)) throw new Error('out-of-range');
      const sight = traceVoxelRay(eye, center, (x, y, z) => this.options.getVoxel([x, y, z]));
      if (sight !== 'clear') throw new Error(sight === 'unavailable' ? 'chunk-unavailable' : 'blocked');
    };
    geometry();
    const nextStation = candidate.station;
    if (
      nextStation &&
      furnaceActive(nextStation, this.options.content) &&
      !furnaceActive(station.component, this.options.content) &&
      this.activeFurnaces().length >= FURNACE_PARTITIONS * FURNACE_PARTITION_SIZE
    )
      throw new RangeError('Active furnace capacity exceeded.');
    const components = this.options.entities.actorComponentSnapshot(actorId);
    const changedTool = !same(actor.slots[actor.equipment.selectedSlot], candidate.slots[actor.equipment.selectedSlot]);
    const cancellation = changedTool
      ? this.options.simulation().prepareCancellation([actorId], 'slot-changed')
      : undefined;
    const stationChanged = !!nextStation && nextStation.revision !== station.component.revision;
    const mutation = candidate.changed
      ? prepareEntityMutation(this.options.entities, {
          actors: [
            {
              reference: candidate.actorReference,
              health: this.options.entities.actorStateAccess(actorId).health,
              components: {
                ...components,
                inventory: [...candidate.slots],
                inventoryRevision: candidate.inventoryRevision,
                inventoryCursor: candidate.cursor,
                ...(changedTool && components.player ? { player: { ...components.player, breakAction: null } } : {}),
              },
            },
          ],
          ...(stationChanged ? { stations: [{ reference: candidate.stationReference!, snapshot: nextStation! }] } : {}),
          spawns: candidate.dropIntents.map((stack) => ({
            position: this.options.entities.get(actorId)!.position,
            stack: { ...stack },
          })),
        })
      : undefined;
    const revision = this.options.revision();
    let used = false,
      validated = false;
    return {
      ok: true,
      revision: revision + Number(candidate.changed),
      value: candidate.result,
      validate: () => {
        validated = false;
        if (used || this.options.revision() !== revision) throw new Error('Prepared station pointer action is stale.');
        this.validateObserved(observed);
        authorize();
        geometry();
        if (candidate.changed) this.options.assertCanChange();
        mutation?.validate();
        cancellation?.validate();
        validated = true;
      },
      apply: () => {
        if (used || !validated) throw new Error('Station pointer commit requires validation.');
        mutation?.apply();
        cancellation?.apply();
        if (candidate.changed) this.options.changed(true);
        used = true;
      },
    };
  }
  private prepareFurnaces(
    observed: readonly ObservedModState[],
    execution: RegisteredCommitContext,
  ): PreparedRegisteredCommit {
    if (
      execution.context.kind !== 'system' ||
      execution.context.systemId !== FURNACE_SYSTEM ||
      execution.context.target.kind !== 'world' ||
      execution.resource !== FURNACE_RESOURCE
    )
      throw new TypeError('Invalid furnace system context.');
    if (
      observed.length !== FURNACE_PARTITIONS ||
      Array.from({ length: FURNACE_PARTITIONS }, (_, index) => furnaceWorldAddress(index)).some(
        (address) => !observed.some((entry) => same(entry.address, address)),
      )
    )
      throw new TypeError('Furnace observation scope mismatch.');
    const candidate = buildFurnaceWorldCandidate(
      this.activeFurnaces(),
      furnaceSeconds(execution.effectiveInput),
      this.options.content,
    );
    if (!same(candidate, execution.candidateValue))
      throw new TypeError('Furnace candidate differs from authoritative state.');
    const segments = [];
    for (let offset = 0; offset < candidate.updates.length; offset += FURNACE_PARTITION_SIZE)
      segments.push({
        stations: candidate.updates
          .slice(offset, offset + FURNACE_PARTITION_SIZE)
          .map((entry) => ({ reference: entry.reference, snapshot: entry.component })),
      });
    const mutation = segments.length ? prepareEntityMutationSeries(this.options.entities, segments) : undefined;
    const revision = this.options.revision();
    const geometry = () => {
      for (const entry of this.activeFurnaces())
        if (this.options.getVoxel([...entry.position]) !== entry.component.voxel)
          throw new Error('station-voxel-mismatch');
    };
    geometry();
    if (mutation) this.options.assertCanChange();
    let used = false,
      validated = false;
    return {
      ok: true,
      revision: revision + (mutation ? 1 : 0),
      value: { version: 1, advanced: candidate.updates.length },
      validate: () => {
        validated = false;
        if (used || revision !== this.options.revision()) throw new Error('Prepared furnace action is stale.');
        this.validateObserved(observed);
        geometry();
        if (mutation) this.options.assertCanChange();
        mutation?.validate();
        validated = true;
      },
      apply: () => {
        if (used || !validated) throw new Error('Furnace commit requires validation.');
        mutation?.apply();
        if (mutation) this.options.changed(false);
        used = true;
      },
    };
  }
}

import type { ModuleInvocationValue, WorldComposition } from '../../composition/contracts';
import type {
  ModStateAddress,
  ObservedModState,
  PreparedRegisteredCommit,
  RegisteredCommitContext,
  RegisteredStatePort,
} from '../../composition/operation-contracts';
import type { EntityStore } from '../entity-store';
import { prepareEntityMutation } from '../prepared-entity-mutation';
import { Voxel } from '../../../world/voxel';
import {
  FORAGE_ADVANCE_OPERATION,
  FORAGE_CAPABILITY,
  FORAGE_HORIZONTAL_RADIUS,
  FORAGE_MAX_DROPS,
  FORAGE_OCCUPANCY_RADIUS,
  FORAGE_RESOURCE,
  FORAGE_SYSTEM,
  FORAGE_VERTICAL_MAX,
  FORAGE_VERTICAL_MIN,
  FORAGE_WORLD_COMPONENT,
  buildForageCandidate,
  forageWorldAddress,
  validateForageConfiguration,
  type ForageCandidateV1,
  type ForageModuleConfiguration,
  type ForageObserverProjectionV1,
  type ForageSourceProjectionV1,
  type ForageWorldProjectionV1,
} from './forage-model';

type Options = Readonly<{
  composition: WorldComposition;
  entities: EntityStore;
  getLoadedVoxel(position: [number, number, number]): number | undefined;
  revision(): number;
  assertCanChange(): void;
  changed(inventoryOperation: boolean): void;
}>;

type ForageCapability = Readonly<{ resolve(): ForageModuleConfiguration }>;
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const sourceKey = (position: readonly number[]) => position.join(',');

/** Projects bounded loaded-world observations and commits all renewable drops through the existing ECS owner. */
export class RegisteredForageRuntime {
  readonly state: RegisteredStatePort;
  private sequence = 0;
  private readonly receipts = new Map<number, string>();
  private readonly configuration: ForageModuleConfiguration;

  constructor(private readonly options: Options) {
    this.configuration = validateForageConfiguration(
      options.composition.capability<ForageCapability>(FORAGE_CAPABILITY).resolve(),
      options.entities.items,
    );
    this.state = {
      read: (address) => {
        const value = this.project(address);
        if (this.sequence === Number.MAX_SAFE_INTEGER) throw new RangeError('Forage observation capacity exhausted.');
        const revision = ++this.sequence;
        this.receipts.set(revision, this.signature(address, value));
        while (this.receipts.size > 128) this.receipts.delete(this.receipts.keys().next().value!);
        return { revision, value };
      },
      commit: () => ({ ok: false, reason: 'Forage requires prepared ECS commit.' }),
      prepareCommit: (observed, writes, execution) => {
        if (writes.length)
          return { ok: false, code: 'FORAGE_WRITE_FORBIDDEN', reason: 'Forage returns an immutable spawn candidate.' };
        this.validateObserved(observed);
        return this.prepare(observed, execution);
      },
    };
  }

  private observers(): readonly ForageObserverProjectionV1[] {
    return this.options.entities
      .query({ type: 'player' })
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
      .flatMap((entity) => {
        const actor = this.options.entities.actorStateAccess(entity.id);
        const reference = this.options.entities.createReference(entity.id);
        return actor.lifecycle === 'alive' && actor.mode === 'survival' && reference
          ? [{ reference, position: [...entity.position] as [number, number, number] }]
          : [];
      });
  }

  private occupied(position: readonly [number, number, number]): boolean {
    return this.options.entities
      .queryNearby([...position], FORAGE_OCCUPANCY_RADIUS, { type: 'world-item' })
      .some((entity) => entity.stack?.itemId === this.configuration.drop.itemId);
  }

  private sources(observers: readonly ForageObserverProjectionV1[]): readonly ForageSourceProjectionV1[] {
    const sources: ForageSourceProjectionV1[] = [];
    const seen = new Set<string>();
    for (const observer of observers) {
      const centerX = Math.floor(observer.position[0]);
      const feetY = Math.floor(observer.position[1]);
      const centerZ = Math.floor(observer.position[2]);
      for (let x = centerX - FORAGE_HORIZONTAL_RADIUS; x <= centerX + FORAGE_HORIZONTAL_RADIUS; x++)
        for (let z = centerZ - FORAGE_HORIZONTAL_RADIUS; z <= centerZ + FORAGE_HORIZONTAL_RADIUS; z++)
          for (let y = feetY + FORAGE_VERTICAL_MIN; y <= feetY + FORAGE_VERTICAL_MAX; y++) {
            const source: [number, number, number] = [x, y, z];
            const id = sourceKey(source);
            if (seen.has(id)) continue;
            seen.add(id);
            if (this.options.getLoadedVoxel(source) !== this.configuration.sourceVoxel) continue;
            const drop: [number, number, number] = [x + 0.5, y - 0.5, z + 0.5];
            if (this.options.getLoadedVoxel([x, y - 1, z]) !== Voxel.Air || this.occupied(drop)) continue;
            sources.push({ observerId: observer.reference.entityId, position: source });
            if (sources.length === FORAGE_MAX_DROPS) return sources;
          }
    }
    return sources;
  }

  private project(address: ModStateAddress): ModuleInvocationValue {
    if (
      address.componentId !== FORAGE_WORLD_COMPONENT ||
      address.target.kind !== 'world' ||
      address.partition !== undefined
    )
      throw new TypeError('Invalid forage world address.');
    const available = this.observers();
    const sources = this.sources(available);
    const participating = new Set(sources.map((source) => source.observerId));
    const observers = available.filter((observer) => participating.has(observer.reference.entityId));
    return { version: 1, observers, sources } satisfies ForageWorldProjectionV1;
  }

  private signature(address: ModStateAddress, value = this.project(address)) {
    return JSON.stringify([this.options.revision(), address, value]);
  }

  private validateObserved(observed: readonly ObservedModState[]) {
    if (observed.length !== 1 || !same(observed[0]!.address, forageWorldAddress()))
      throw new TypeError('Forage observation scope mismatch.');
    const receipt = observed[0]!;
    if (this.receipts.get(receipt.revision) !== this.signature(receipt.address))
      throw new Error('Forage observation is stale.');
  }

  private validateDrop(drop: ForageCandidateV1['drops'][number]) {
    const observer = this.options.entities.resolveReference(drop.observerReference);
    if (!observer || observer.type !== 'player') throw new Error('stale-forage-observer');
    const actor = this.options.entities.actorStateAccess(observer.id);
    if (actor.lifecycle !== 'alive' || actor.mode !== 'survival') throw new Error('ineligible-forage-observer');
    const feetY = Math.floor(observer.position[1]);
    if (
      Math.abs(drop.source[0] - Math.floor(observer.position[0])) > FORAGE_HORIZONTAL_RADIUS ||
      Math.abs(drop.source[2] - Math.floor(observer.position[2])) > FORAGE_HORIZONTAL_RADIUS ||
      drop.source[1] < feetY + FORAGE_VERTICAL_MIN ||
      drop.source[1] > feetY + FORAGE_VERTICAL_MAX
    )
      throw new Error('forage-observer-moved');
    if (this.options.getLoadedVoxel([...drop.source]) !== this.configuration.sourceVoxel)
      throw new Error('forage-source-changed');
    if (this.options.getLoadedVoxel([drop.source[0], drop.source[1] - 1, drop.source[2]]) !== Voxel.Air)
      throw new Error('forage-drop-blocked');
    if (this.occupied(drop.position)) throw new Error('forage-drop-occupied');
  }

  private prepare(observed: readonly ObservedModState[], execution: RegisteredCommitContext): PreparedRegisteredCommit {
    if (
      execution.operationId !== FORAGE_ADVANCE_OPERATION ||
      execution.resource !== FORAGE_RESOURCE ||
      execution.context.kind !== 'system' ||
      execution.context.systemId !== FORAGE_SYSTEM ||
      execution.context.target.kind !== 'world'
    )
      throw new TypeError('Invalid forage system execution.');
    const projection = this.project(forageWorldAddress()) as ForageWorldProjectionV1;
    const candidate = buildForageCandidate(projection, this.configuration);
    if (!same(candidate, execution.candidateValue))
      throw new TypeError('Forage candidate differs from authoritative state.');
    candidate.drops.forEach((drop) => this.validateDrop(drop));
    const mutation = candidate.drops.length
      ? prepareEntityMutation(this.options.entities, {
          spawns: candidate.drops.map((drop) => ({ position: drop.position, stack: drop.stack })),
        })
      : undefined;
    const revision = this.options.revision();
    if (mutation) this.options.assertCanChange();
    let used = false;
    let validated = false;
    return {
      ok: true,
      revision: revision + Number(Boolean(mutation)),
      value: { version: 1, spawned: mutation?.spawnIds ?? [] },
      validate: () => {
        validated = false;
        if (used || revision !== this.options.revision()) throw new Error('Prepared forage action is stale.');
        this.validateObserved(observed);
        candidate.drops.forEach((drop) => this.validateDrop(drop));
        if (mutation) this.options.assertCanChange();
        mutation?.validate();
        validated = true;
      },
      apply: () => {
        if (used || !validated) throw new Error('Forage commit requires validation.');
        mutation?.apply();
        if (mutation) this.options.changed(false);
        used = true;
      },
    };
  }
}

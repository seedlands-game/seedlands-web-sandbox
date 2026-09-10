import { isActorEntityType } from '../ecs-actor-state';
import type { EntityStore } from '../entity-store';
import type { RegisteredStatePort, ModStateAddress } from '../../composition/operation-contracts';
import {
  prepareEntityMutationSeries,
  type PreparedEntityMutationInput,
  type PreparedActorReplacement,
  type PreparedWorldItemSpawn,
} from '../prepared-entity-mutation';
import {
  NEEDS_COMPONENT,
  NEEDS_PARTITIONS,
  NEEDS_PARTITION_SIZE,
  validateNeedsPartition,
  type NeedsEntry,
  type NeedsPartitionV1,
} from './needs-model';

type PreparedEffect = Readonly<{ validate(): void; apply(): void }>;
export function createNeedsStatePort(
  options: Readonly<{
    entities: EntityStore;
    actorIds(): readonly string[];
    revision(): number;
    assertCanChange(): void;
    changed(): void;
    prepareDeaths(ids: readonly string[]): PreparedEffect;
  }>,
): RegisteredStatePort {
  const partitionId = (address: ModStateAddress) => {
    if (
      address.componentId !== NEEDS_COMPONENT ||
      address.target.kind !== 'world' ||
      !Number.isSafeInteger(address.partition) ||
      address.partition! < 0 ||
      address.partition! >= NEEDS_PARTITIONS
    )
      throw new TypeError('Needs partition address is invalid.');
    return address.partition!;
  };
  const project = (id: string): NeedsEntry => {
    const entity = options.entities.get(id);
    const reference = options.entities.createReference(id);
    if (
      !entity ||
      !reference ||
      !isActorEntityType(entity.type) ||
      entity.health === undefined ||
      entity.maxHealth === undefined
    )
      throw new TypeError('Needs actor is unavailable.');
    const actor = options.entities.actorStateAccess(id);
    const needs = options.entities.actorNeedsSnapshot(id);
    return {
      reference,
      kind: entity.type,
      health: actor.health,
      maxHealth: actor.maxHealth,
      lifecycle: actor.lifecycle,
      mode: { version: 1, value: actor.mode, revision: actor.modeRevision },
      needs,
    };
  };
  const entries = () => {
    const ids = [...options.actorIds()].sort();
    if (ids.length > NEEDS_PARTITIONS * NEEDS_PARTITION_SIZE || new Set(ids).size !== ids.length)
      throw new RangeError('Needs actor membership exceeds its world budget.');
    const values = ids.map(project);
    if (
      values.filter((entry) => entry.kind === 'player').length > 128 ||
      values.filter((entry) => entry.kind !== 'player').length > 512
    )
      throw new RangeError('Needs player or autonomous actor budget exceeded.');
    return values;
  };
  const partition = (values: readonly NeedsEntry[], index: number): NeedsPartitionV1 => ({
    version: 1,
    partition: index,
    entries: values.slice(index * NEEDS_PARTITION_SIZE, (index + 1) * NEEDS_PARTITION_SIZE),
  });
  const immutable = (entry: NeedsEntry) =>
    JSON.stringify({
      reference: entry.reference,
      kind: entry.kind,
      maxHealth: entry.maxHealth,
      mode: entry.mode,
      maxHunger: entry.needs.maxHunger,
      hungerMeaning: entry.needs.hungerMeaning,
    });
  return {
    read(address) {
      return { revision: options.revision(), value: partition(entries(), partitionId(address)) };
    },
    commit(observed, writes) {
      const revision = options.revision();
      for (const entry of observed) {
        partitionId(entry.address);
        if (entry.revision !== revision) return { ok: false, reason: 'needs-stale' };
      }
      const original = entries();
      const seen = new Set<number>();
      const actors: PreparedActorReplacement[] = [],
        spawns: PreparedWorldItemSpawn[] = [],
        deaths: string[] = [];
      for (const write of writes) {
        const index = partitionId(write.address);
        if (seen.has(index) || !observed.some((entry) => entry.address.partition === index))
          return { ok: false, reason: 'needs-partition-conflict' };
        seen.add(index);
        const candidate = validateNeedsPartition(write.value);
        const before = partition(original, index);
        if (candidate.partition !== index || candidate.entries.length !== before.entries.length)
          return { ok: false, reason: 'needs-membership-changed' };
        for (let offset = 0; offset < before.entries.length; offset++) {
          const previous = before.entries[offset],
            next = candidate.entries[offset];
          if (
            immutable(previous) !== immutable(next) ||
            (previous.kind !== 'player' && (previous.health !== next.health || previous.lifecycle !== next.lifecycle))
          )
            return { ok: false, reason: 'needs-readonly-fields-changed' };
          if (JSON.stringify(previous) === JSON.stringify(next)) continue;
          let components = options.entities.actorComponentSnapshot(previous.reference.entityId);
          components = { ...components, needs: { ...next.needs }, lifecycle: next.lifecycle };
          if (previous.lifecycle === 'alive' && next.lifecycle === 'dead') {
            deaths.push(previous.reference.entityId);
            const position = options.entities.get(previous.reference.entityId)!.position;
            spawns.push(...components.inventory.flatMap((stack) => (stack ? [{ position, stack }] : [])));
            components = {
              ...components,
              inventory: components.inventory.map(() => null),
              player: { ...components.player!, breakAction: null },
            };
          }
          actors.push({ reference: previous.reference, health: next.health, components });
        }
      }
      if (!actors.length) return { ok: true, revision };
      options.assertCanChange();
      const segments: PreparedEntityMutationInput[] = [];
      for (let start = 0; start < actors.length; start += 128)
        segments.push({ actors: actors.slice(start, start + 128) });
      for (let start = 0; start < spawns.length; start += 128)
        segments.push({ spawns: spawns.slice(start, start + 128) });
      const entity = prepareEntityMutationSeries(options.entities, segments);
      const effects = deaths.length ? options.prepareDeaths(deaths) : null;
      entity.validate();
      effects?.validate();
      entity.apply();
      effects?.apply();
      options.changed();
      return { ok: true, revision: options.revision() };
    },
  };
}

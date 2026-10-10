import { isActorEntityType } from '../ecs-actor-state';
import type { EntityStore } from '../entity-store';
import type { RegisteredStatePort, ModStateAddress } from '../../composition/operation-contracts';
import type { WorldComposition } from '../../composition/contracts';
import {
  prepareEntityMutationSeries,
  type PreparedEntityMutationInput,
  type PreparedActorReplacement,
} from '../prepared-entity-mutation';
import {
  buildDeathInventorySettlementCandidateV1,
  prepareDeathInventorySettlementSeriesV1,
  type DeathInventoryAdditionalActorReplacementV1,
  type DeathInventorySettlementCandidateV1,
  type DeathInventorySettlementPolicyV1,
} from '../death-inventory-settlement';
import {
  resolveDeathInventoryPolicyCapabilityV1,
  type DeathInventoryPolicyCapabilityV1,
} from './death-inventory-policy-module';
import {
  NEEDS_COMPONENT,
  NEEDS_PARTITIONS,
  NEEDS_PARTITION_SIZE,
  validateNeedsPartition,
  type NeedsEntry,
  type NeedsPartitionV1,
} from './needs-model';

type PreparedEffect = Readonly<{ validate(): void; apply(): void }>;
type NeedsDeathInventoryMode =
  Readonly<{ kind: 'legacy' }> | Readonly<{ kind: 'composed'; capability: DeathInventoryPolicyCapabilityV1 | null }>;

const LEGACY_PLAYER_DEATH_POLICY: DeathInventorySettlementPolicyV1 = Object.freeze({
  inventory: 'drop',
  cursor: 'retain',
  crafting: 'retain',
  armor: 'retain',
  actor: 'retain',
});

export const resolveNeedsDeathInventoryMode = (composition?: WorldComposition): NeedsDeathInventoryMode =>
  composition
    ? { kind: 'composed', capability: resolveDeathInventoryPolicyCapabilityV1(composition) }
    : { kind: 'legacy' };

export function createNeedsStatePort(
  options: Readonly<{
    entities: EntityStore;
    actorIds(): readonly string[];
    revision(): number;
    assertCanChange(): void;
    changed(): void;
    prepareDeaths(ids: readonly string[]): PreparedEffect;
    deathInventory: NeedsDeathInventoryMode;
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
        additionalActorReplacements: DeathInventoryAdditionalActorReplacementV1[] = [],
        deathCandidates: DeathInventorySettlementCandidateV1[] = [],
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
          const sourceComponents = options.entities.actorComponentSnapshot(previous.reference.entityId);
          let components = { ...sourceComponents, needs: { ...next.needs }, lifecycle: next.lifecycle };
          if (previous.lifecycle === 'alive' && next.lifecycle === 'dead') {
            if (previous.kind !== 'player') return { ok: false, reason: 'needs-non-player-death-unsupported' };
            const policy =
              options.deathInventory.kind === 'legacy'
                ? LEGACY_PLAYER_DEATH_POLICY
                : options.deathInventory.capability?.policyFor('player');
            if (!policy) return { ok: false, reason: 'death-inventory-policy-unavailable' };
            if (policy.actor === 'despawn') return { ok: false, reason: 'needs-player-despawn-policy-unsupported' };
            deaths.push(previous.reference.entityId);
            const position = options.entities.get(previous.reference.entityId)!.position;
            components = {
              ...components,
              player: { ...components.player!, breakAction: null },
            };
            deathCandidates.push(
              buildDeathInventorySettlementCandidateV1({
                source: {
                  actorReference: previous.reference,
                  health: previous.health,
                  components: sourceComponents,
                },
                position,
                settlementComponents: components,
                policy,
              }),
            );
            continue;
          }
          const replacement = { reference: previous.reference, health: next.health, components };
          actors.push(replacement);
          additionalActorReplacements.push({
            source: { actorReference: previous.reference, health: previous.health, components: sourceComponents },
            replacement,
          });
        }
      }
      if (!actors.length && !deathCandidates.length) return { ok: true, revision };
      options.assertCanChange();
      const entity = deathCandidates.length
        ? prepareDeathInventorySettlementSeriesV1(options.entities, {
            candidates: deathCandidates,
            additionalActorReplacements,
          })
        : prepareEntityMutationSeries(options.entities, actorSegments(actors));
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

function actorSegments(actors: readonly PreparedActorReplacement[]): PreparedEntityMutationInput[] {
  const segments: PreparedEntityMutationInput[] = [];
  for (let start = 0; start < actors.length; start += 128) segments.push({ actors: actors.slice(start, start + 128) });
  return segments;
}

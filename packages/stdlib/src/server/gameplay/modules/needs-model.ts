import type { ActorNeeds, ActorModeComponentV1 } from '../ecs-actor-components';
import type { EntityLifetimeReference } from '../entity-store';
import type { WorldRulesetV1 } from './ruleset-module';

export const NEEDS_COMPONENT = 'seedlands:actor-needs';
export const NEEDS_RESOURCE = 'seedlands.needs';
export const NEEDS_CAPABILITY = 'seedlands:needs';
export const NEEDS_PARTITIONS = 5;
export const NEEDS_PARTITION_SIZE = 128;
export type NeedsEntry = Readonly<{
  reference: EntityLifetimeReference;
  kind: 'player' | 'creature' | 'npc';
  health: number;
  maxHealth: number;
  lifecycle: 'alive' | 'dead';
  mode: ActorModeComponentV1;
  needs: ActorNeeds;
}>;
export type NeedsPartitionV1 = Readonly<{ version: 1; partition: number; entries: readonly NeedsEntry[] }>;
export type NeedsProfile = Readonly<{
  enabledModes: readonly ('survival' | 'creative')[];
  hungerEverySeconds: number;
  hungerDelta: number;
  heal?: Readonly<{ threshold: number; everySeconds: number; amount: number; hungerCost: number }>;
  starvation?: Readonly<{ threshold: number; everySeconds: number; damage: number }>;
}>;
export type NeedsProfiles = Readonly<{ satiety: NeedsProfile; deficit: NeedsProfile }>;
export type NeedsPolicy = Readonly<{ seconds: number; ruleset: WorldRulesetV1; profiles: NeedsProfiles }>;

export function needsData(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new TypeError('Needs data must be an object.');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors))
    if (typeof key !== 'string' || !allowed.includes(key) || !('value' in descriptors[key]))
      throw new TypeError('Needs data has invalid fields.');
  return value as Record<string, unknown>;
}
const finite = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

export function validateNeedsPartition(value: unknown): NeedsPartitionV1 {
  const part = needsData(value, ['version', 'partition', 'entries']);
  if (
    part.version !== 1 ||
    !Number.isSafeInteger(part.partition) ||
    !finite(part.partition, 0, NEEDS_PARTITIONS - 1) ||
    !Array.isArray(part.entries) ||
    part.entries.length > NEEDS_PARTITION_SIZE
  )
    throw new TypeError('Needs partition is invalid.');
  const seen = new Set<string>();
  for (const raw of part.entries) {
    const entry = needsData(raw, ['reference', 'kind', 'health', 'maxHealth', 'lifecycle', 'mode', 'needs']);
    const reference = needsData(entry.reference, ['entityId', 'epoch', 'lifetime']);
    const mode = needsData(entry.mode, ['version', 'value', 'revision']);
    const needs = needsData(entry.needs, [
      'hunger',
      'maxHunger',
      'hungerMeaning',
      'hungerAccumulator',
      'healingAccumulator',
      'starvationAccumulator',
    ]);
    if (
      typeof reference.entityId !== 'string' ||
      !reference.entityId.trim() ||
      reference.entityId.length > 256 ||
      seen.has(reference.entityId) ||
      !Number.isSafeInteger(reference.epoch) ||
      !finite(reference.epoch, 1) ||
      !Number.isSafeInteger(reference.lifetime) ||
      !finite(reference.lifetime, 1) ||
      !['player', 'creature', 'npc'].includes(String(entry.kind)) ||
      !finite(entry.maxHealth, Number.EPSILON) ||
      !finite(entry.health, 0, entry.maxHealth) ||
      !['alive', 'dead'].includes(String(entry.lifecycle)) ||
      (entry.health === 0) !== (entry.lifecycle === 'dead') ||
      mode.version !== 1 ||
      !['survival', 'creative'].includes(String(mode.value)) ||
      !Number.isSafeInteger(mode.revision) ||
      !finite(mode.revision) ||
      !finite(needs.maxHunger, Number.EPSILON) ||
      !finite(needs.hunger, 0, needs.maxHunger) ||
      !['satiety', 'deficit'].includes(String(needs.hungerMeaning)) ||
      !finite(needs.hungerAccumulator) ||
      !finite(needs.healingAccumulator) ||
      !finite(needs.starvationAccumulator)
    )
      throw new TypeError('Needs actor projection is invalid.');
    seen.add(reference.entityId);
  }
  return value as NeedsPartitionV1;
}

export function validateNeedsProfiles(value: unknown): NeedsProfiles {
  const profiles = needsData(value, ['satiety', 'deficit']);
  for (const raw of [profiles.satiety, profiles.deficit]) {
    const profile = needsData(raw, ['enabledModes', 'hungerEverySeconds', 'hungerDelta', 'heal', 'starvation']);
    if (
      !Array.isArray(profile.enabledModes) ||
      profile.enabledModes.length > 2 ||
      Array.from(profile.enabledModes).some((mode) => mode !== 'survival' && mode !== 'creative') ||
      new Set(profile.enabledModes).size !== profile.enabledModes.length ||
      !finite(profile.hungerEverySeconds, 1, 86400) ||
      !finite(profile.hungerDelta, -100, 100)
    )
      throw new TypeError('Needs policy profile is invalid.');
    if (profile.heal !== undefined) {
      const heal = needsData(profile.heal, ['threshold', 'everySeconds', 'amount', 'hungerCost']);
      if (
        !finite(heal.threshold) ||
        !finite(heal.everySeconds, 1, 86400) ||
        !finite(heal.amount, Number.EPSILON, 100) ||
        !finite(heal.hungerCost, Number.EPSILON, 100)
      )
        throw new TypeError('Needs healing policy is invalid.');
    }
    if (profile.starvation !== undefined) {
      const starvation = needsData(profile.starvation, ['threshold', 'everySeconds', 'damage']);
      if (
        !finite(starvation.threshold) ||
        !finite(starvation.everySeconds, 1, 86400) ||
        !finite(starvation.damage, Number.EPSILON, 100)
      )
        throw new TypeError('Needs starvation policy is invalid.');
    }
  }
  return value as NeedsProfiles;
}

const phase = (seconds: number) => Math.round(seconds * 1e9) / 1e9;

export function advanceNeedsEntry(entry: NeedsEntry, profile: NeedsProfile, seconds: number): NeedsEntry {
  if (entry.lifecycle !== 'alive' || !profile.enabledModes.includes(entry.mode.value)) return entry;
  const needs = { ...entry.needs };
  let health = entry.health;
  needs.hungerAccumulator = phase(needs.hungerAccumulator + seconds);
  const hungerSteps = Math.floor(needs.hungerAccumulator / profile.hungerEverySeconds);
  needs.hungerAccumulator = phase(needs.hungerAccumulator - hungerSteps * profile.hungerEverySeconds);
  needs.hunger = Math.max(0, Math.min(needs.maxHunger, needs.hunger + hungerSteps * profile.hungerDelta));
  const heal = profile.heal;
  if (heal && needs.hunger >= heal.threshold && health < entry.maxHealth) {
    needs.healingAccumulator = phase(needs.healingAccumulator + seconds);
    const steps = Math.min(
      Math.floor(needs.healingAccumulator / heal.everySeconds),
      Math.ceil((entry.maxHealth - health) / heal.amount),
      Math.floor((needs.hunger - heal.threshold) / heal.hungerCost) + 1,
    );
    needs.healingAccumulator = phase(needs.healingAccumulator - steps * heal.everySeconds);
    health = Math.min(entry.maxHealth, health + steps * heal.amount);
    needs.hunger = Math.max(0, needs.hunger - steps * heal.hungerCost);
  } else needs.healingAccumulator = 0;
  const starvation = profile.starvation;
  if (starvation && needs.hunger === starvation.threshold) {
    needs.starvationAccumulator = phase(needs.starvationAccumulator + seconds);
    const steps = Math.min(
      Math.floor(needs.starvationAccumulator / starvation.everySeconds),
      Math.ceil(health / starvation.damage),
    );
    needs.starvationAccumulator = phase(needs.starvationAccumulator - steps * starvation.everySeconds);
    health = Math.max(0, health - steps * starvation.damage);
  } else needs.starvationAccumulator = 0;
  return { ...entry, needs, health, lifecycle: health === 0 ? 'dead' : 'alive' };
}

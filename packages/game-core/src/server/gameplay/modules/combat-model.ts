import type { EntityLifetimeReference } from '../entity-store';
import type { CombatSnapshot } from '../combat-runtime';

export const COMBAT_CAPABILITY = 'seedlands:combat';
export const COMBAT_ACTOR_COMPONENT = 'seedlands:combat-actor';
export const COMBAT_WORLD_COMPONENT = 'seedlands:combat-world';
export const COMBAT_RESOURCE = 'seedlands.combat';
export const COMBAT_CLOCK_RESOURCE = 'seedlands.combat-clock';
export const COMBAT_REQUEST_OPERATION = 'seedlands:request-combat';
export const COMBAT_RESOLVE_OPERATION = 'seedlands:resolve-combat';
export const COMBAT_ADVANCE_OPERATION = 'seedlands:advance-combat';
export const COMBAT_SYSTEM = 'seedlands:combat-system';
export const COMBAT_PARTITIONS = 5;
export const COMBAT_PARTITION_SIZE = 128;

export type CombatModeProjection = Readonly<{ value: 'survival' | 'creative'; revision: number }>;
export type CombatPendingProjection = Readonly<{ token: string; targetId: string; baseDamage: number }>;
export type CombatActorProjectionV1 = Readonly<{
  version: 1;
  reference: EntityLifetimeReference;
  kind: 'player' | 'creature' | 'npc';
  health: number;
  maxHealth: number;
  lifecycle: 'alive' | 'dead';
  mode: CombatModeProjection;
  meleeDefinitionId: string | null;
  combat: CombatSnapshot;
  pending: CombatPendingProjection | null;
}>;
export type CombatWorldEntry = Readonly<{
  reference: EntityLifetimeReference;
  active: boolean;
  pending: boolean;
}>;
export type CombatWorldPartitionV1 = Readonly<{
  version: 1;
  partition: number;
  entries: readonly CombatWorldEntry[];
}>;
export type CombatCapabilityV1 = Readonly<{
  actorComponentId: typeof COMBAT_ACTOR_COMPONENT;
  worldComponentId: typeof COMBAT_WORLD_COMPONENT;
  requestOperationId: typeof COMBAT_REQUEST_OPERATION;
  resolveOperationId: typeof COMBAT_RESOLVE_OPERATION;
  advanceOperationId: typeof COMBAT_ADVANCE_OPERATION;
  partitions: typeof COMBAT_PARTITIONS;
}>;

export type CombatRequestCandidateV1 = Readonly<{
  version: 1;
  kind: 'request';
  actorId: string;
  targetId: string;
  definitionId: string;
  rulesetRevision: number;
}>;
export type CombatResolveCandidateV1 = Readonly<{
  version: 1;
  kind: 'resolve';
  actorId: string;
  targetId: string;
  token: string;
  damage: number;
  rulesetRevision: number;
}>;
export type CombatAdvanceCandidateV1 = Readonly<{
  version: 1;
  kind: 'advance';
  seconds: number;
  cancelTokens?: readonly string[];
}>;
export type CombatCandidateV1 = CombatRequestCandidateV1 | CombatResolveCandidateV1 | CombatAdvanceCandidateV1;

export type CombatRequestEffectiveInput = Readonly<{ targetId: string; rulesetRevision: number }>;
export type CombatResolveEffectiveInput = Readonly<{ token: string; damage: number; rulesetRevision: number }>;
export type CombatRulesProfile = Readonly<{
  damageMultiplier: number;
  immuneTargetModes: readonly ('survival' | 'creative')[];
}>;

export const combatActorAddress = (entityId: string) => ({
  componentId: COMBAT_ACTOR_COMPONENT,
  target: { kind: 'entity' as const, entityId },
});
export const combatWorldAddress = (partition: number) => ({
  componentId: COMBAT_WORLD_COMPONENT,
  target: { kind: 'world' as const },
  partition,
});

export function combatData(raw: unknown, allowed: readonly string[], label = 'Combat data'): Record<string, unknown> {
  if (
    !raw ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(raw))
  )
    throw new TypeError(`${label} must be an object.`);
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  for (const key of Reflect.ownKeys(descriptors))
    if (
      typeof key !== 'string' ||
      !allowed.includes(key) ||
      !descriptors[key].enumerable ||
      !('value' in descriptors[key])
    )
      throw new TypeError(`${label} has invalid fields.`);
  if (Object.keys(descriptors).length !== allowed.length || allowed.some((key) => !descriptors[key]))
    throw new TypeError(`${label} has missing fields.`);
  return raw as Record<string, unknown>;
}

const finite = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const identity = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 256 && value.trim() === value;
const pendingToken = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 8192 && value.trim() === value;
const safeRevision = (value: unknown): value is number => Number.isSafeInteger(value) && finite(value);

function validateReference(raw: unknown): EntityLifetimeReference {
  const value = combatData(raw, ['entityId', 'epoch', 'lifetime'], 'Combat entity reference');
  if (
    !identity(value.entityId) ||
    !safeRevision(value.epoch) ||
    value.epoch === 0 ||
    !safeRevision(value.lifetime) ||
    value.lifetime === 0
  )
    throw new TypeError('Combat entity reference is invalid.');
  return Object.freeze({ entityId: value.entityId, epoch: value.epoch, lifetime: value.lifetime });
}

function validatePublicCombat(raw: unknown): CombatSnapshot {
  const value = combatData(raw, ['active', 'cooldownRemainingSeconds', 'lastResult'], 'Combat public snapshot');
  if (!finite(value.cooldownRemainingSeconds)) throw new TypeError('Combat cooldown is invalid.');
  let active: CombatSnapshot['active'] = null;
  if (value.active !== null) {
    const current = combatData(
      value.active,
      [
        'actionId',
        'definitionId',
        'targetId',
        'comboStep',
        'comboLength',
        'phase',
        'phaseElapsedSeconds',
        'phaseDurationSeconds',
        'canBuffer',
        'buffered',
      ],
      'Combat active projection',
    );
    if (
      !identity(current.actionId) ||
      !identity(current.definitionId) ||
      !identity(current.targetId) ||
      !safeRevision(current.comboStep) ||
      !Number.isSafeInteger(current.comboLength) ||
      !finite(current.comboLength, 1) ||
      !['windup', 'hit', 'recovery'].includes(String(current.phase)) ||
      !finite(current.phaseElapsedSeconds) ||
      !finite(current.phaseDurationSeconds) ||
      current.phaseElapsedSeconds > current.phaseDurationSeconds ||
      typeof current.canBuffer !== 'boolean' ||
      typeof current.buffered !== 'boolean'
    )
      throw new TypeError('Combat active projection is invalid.');
    active = Object.freeze(current as unknown as NonNullable<CombatSnapshot['active']>);
  }
  let lastResult: CombatSnapshot['lastResult'] = null;
  if (value.lastResult !== null) {
    const allowed = ['sequence', 'actionId', 'definitionId', 'targetId', 'comboStep', 'outcome', 'damage'];
    const hasReason = Object.hasOwn(value.lastResult as object, 'reason');
    const result = combatData(
      value.lastResult,
      hasReason ? [...allowed, 'reason'] : allowed,
      'Combat result projection',
    );
    if (
      !safeRevision(result.sequence) ||
      !identity(result.actionId) ||
      !identity(result.definitionId) ||
      !identity(result.targetId) ||
      !safeRevision(result.comboStep) ||
      !['hit', 'miss', 'cancelled'].includes(String(result.outcome)) ||
      !finite(result.damage) ||
      (result.reason !== undefined &&
        (typeof result.reason !== 'string' || !result.reason.trim() || result.reason.length > 256))
    )
      throw new TypeError('Combat result projection is invalid.');
    lastResult = Object.freeze(result as unknown as NonNullable<CombatSnapshot['lastResult']>);
  }
  return Object.freeze({ active, cooldownRemainingSeconds: value.cooldownRemainingSeconds, lastResult });
}

export function validateCombatActorProjection(raw: unknown): CombatActorProjectionV1 {
  const value = combatData(
    raw,
    [
      'version',
      'reference',
      'kind',
      'health',
      'maxHealth',
      'lifecycle',
      'mode',
      'meleeDefinitionId',
      'combat',
      'pending',
    ],
    'Combat actor projection',
  );
  const reference = validateReference(value.reference);
  const mode = combatData(value.mode, ['value', 'revision'], 'Combat mode projection');
  if (
    value.version !== 1 ||
    !['player', 'creature', 'npc'].includes(String(value.kind)) ||
    !finite(value.maxHealth, Number.EPSILON) ||
    !finite(value.health, 0, value.maxHealth) ||
    !['alive', 'dead'].includes(String(value.lifecycle)) ||
    (value.health === 0) !== (value.lifecycle === 'dead') ||
    !['survival', 'creative'].includes(String(mode.value)) ||
    !safeRevision(mode.revision) ||
    (value.meleeDefinitionId !== null && !identity(value.meleeDefinitionId))
  )
    throw new TypeError('Combat actor projection is invalid.');
  let pending: CombatPendingProjection | null = null;
  if (value.pending !== null) {
    const hit = combatData(value.pending, ['token', 'targetId', 'baseDamage'], 'Combat pending projection');
    if (!pendingToken(hit.token) || !identity(hit.targetId) || !finite(hit.baseDamage, 0, 1_000_000))
      throw new TypeError('Combat pending projection is invalid.');
    pending = Object.freeze({ token: hit.token, targetId: hit.targetId, baseDamage: hit.baseDamage });
  }
  const combat = validatePublicCombat(value.combat);
  if (
    pending &&
    (combat.active?.targetId !== pending.targetId ||
      combat.active.phase !== 'windup' ||
      combat.active.phaseElapsedSeconds !== combat.active.phaseDurationSeconds)
  )
    throw new TypeError('Combat pending projection does not match the public frontier.');
  return Object.freeze({
    version: 1,
    reference,
    kind: value.kind as CombatActorProjectionV1['kind'],
    health: value.health,
    maxHealth: value.maxHealth,
    lifecycle: value.lifecycle as CombatActorProjectionV1['lifecycle'],
    mode: Object.freeze({ value: mode.value as CombatModeProjection['value'], revision: mode.revision }),
    meleeDefinitionId: value.meleeDefinitionId,
    combat,
    pending,
  });
}

export function validateCombatWorldPartition(raw: unknown): CombatWorldPartitionV1 {
  const value = combatData(raw, ['version', 'partition', 'entries'], 'Combat world partition');
  if (
    value.version !== 1 ||
    !safeRevision(value.partition) ||
    value.partition >= COMBAT_PARTITIONS ||
    !Array.isArray(value.entries) ||
    value.entries.length > COMBAT_PARTITION_SIZE
  )
    throw new TypeError('Combat world partition is invalid.');
  const entries: CombatWorldEntry[] = [];
  let previous = '';
  for (const rawEntry of value.entries) {
    const entry = combatData(rawEntry, ['reference', 'active', 'pending'], 'Combat world entry');
    const reference = validateReference(entry.reference);
    if (reference.entityId <= previous || typeof entry.active !== 'boolean' || typeof entry.pending !== 'boolean')
      throw new TypeError('Combat world entries are invalid or unsorted.');
    previous = reference.entityId;
    entries.push(Object.freeze({ reference, active: entry.active, pending: entry.pending }));
  }
  return Object.freeze({ version: 1, partition: value.partition, entries: Object.freeze(entries) });
}

export const combatCapability = (): CombatCapabilityV1 =>
  Object.freeze({
    actorComponentId: COMBAT_ACTOR_COMPONENT,
    worldComponentId: COMBAT_WORLD_COMPONENT,
    requestOperationId: COMBAT_REQUEST_OPERATION,
    resolveOperationId: COMBAT_RESOLVE_OPERATION,
    advanceOperationId: COMBAT_ADVANCE_OPERATION,
    partitions: COMBAT_PARTITIONS,
  });

export function validateCombatRequestInput(raw: unknown): Readonly<{ targetId: string }> {
  const value = combatData(raw, ['targetId'], 'Combat request input');
  if (!identity(value.targetId)) throw new TypeError('Combat request target is invalid.');
  return Object.freeze({ targetId: value.targetId });
}
export function validateCombatResolveInput(raw: unknown): Readonly<{ token: string }> {
  const value = combatData(raw, ['token'], 'Combat resolve input');
  if (!pendingToken(value.token)) throw new TypeError('Combat resolve token is invalid.');
  return Object.freeze({ token: value.token });
}
export function validateCombatRequestEffectiveInput(raw: unknown): CombatRequestEffectiveInput {
  const value = combatData(raw, ['targetId', 'rulesetRevision'], 'Combat request effective input');
  if (!identity(value.targetId) || !safeRevision(value.rulesetRevision))
    throw new TypeError('Combat request policy is invalid.');
  return Object.freeze({ targetId: value.targetId, rulesetRevision: value.rulesetRevision });
}
export function validateCombatResolveEffectiveInput(raw: unknown): CombatResolveEffectiveInput {
  const value = combatData(raw, ['token', 'damage', 'rulesetRevision'], 'Combat resolve effective input');
  if (!pendingToken(value.token) || !finite(value.damage, 0, 1_000_000) || !safeRevision(value.rulesetRevision))
    throw new TypeError('Combat resolve policy is invalid.');
  return Object.freeze({ token: value.token, damage: value.damage, rulesetRevision: value.rulesetRevision });
}
export function validateCombatAdvanceInput(
  raw: unknown,
): Readonly<{ seconds: number; cancelTokens?: readonly string[] }> {
  const hasCancelTokens = Boolean(raw) && typeof raw === 'object' && Object.hasOwn(raw as object, 'cancelTokens');
  const value = combatData(raw, hasCancelTokens ? ['seconds', 'cancelTokens'] : ['seconds'], 'Combat advance input');
  if (!finite(value.seconds, 0, 1)) throw new TypeError('Combat advance must be between 0 and 1 second.');
  if (!hasCancelTokens) return Object.freeze({ seconds: value.seconds });
  if (
    !Array.isArray(value.cancelTokens) ||
    value.cancelTokens.length > 1024 ||
    value.cancelTokens.some((token) => !pendingToken(token)) ||
    new Set(value.cancelTokens).size !== value.cancelTokens.length
  )
    throw new TypeError('Combat cancellation tokens are invalid or duplicated.');
  return Object.freeze({ seconds: value.seconds, cancelTokens: Object.freeze([...value.cancelTokens]) });
}

export function validateCombatCandidate(raw: unknown): CombatCandidateV1 {
  const kindDescriptor =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? Object.getOwnPropertyDescriptor(raw, 'kind') : undefined;
  if (!kindDescriptor?.enumerable || !('value' in kindDescriptor)) throw new TypeError('Combat candidate is invalid.');
  const base = combatData(
    raw,
    kindDescriptor.value === 'advance'
      ? Object.hasOwn(raw as object, 'cancelTokens')
        ? ['version', 'kind', 'seconds', 'cancelTokens']
        : ['version', 'kind', 'seconds']
      : kindDescriptor.value === 'resolve'
        ? ['version', 'kind', 'actorId', 'targetId', 'token', 'damage', 'rulesetRevision']
        : ['version', 'kind', 'actorId', 'targetId', 'definitionId', 'rulesetRevision'],
    'Combat candidate',
  );
  if (base.version !== 1) throw new TypeError('Combat candidate version is invalid.');
  if (base.kind === 'advance') {
    const advance = validateCombatAdvanceInput(
      Object.hasOwn(base, 'cancelTokens')
        ? { seconds: base.seconds, cancelTokens: base.cancelTokens }
        : { seconds: base.seconds },
    );
    return Object.freeze({ version: 1, kind: 'advance', ...advance });
  }
  if (!identity(base.actorId) || !identity(base.targetId) || !safeRevision(base.rulesetRevision))
    throw new TypeError('Combat candidate identity is invalid.');
  if (base.kind === 'request' && identity(base.definitionId))
    return Object.freeze({
      version: 1,
      kind: 'request',
      actorId: base.actorId,
      targetId: base.targetId,
      definitionId: base.definitionId,
      rulesetRevision: base.rulesetRevision,
    });
  if (base.kind === 'resolve' && pendingToken(base.token) && finite(base.damage, 0, 1_000_000))
    return Object.freeze({
      version: 1,
      kind: 'resolve',
      actorId: base.actorId,
      targetId: base.targetId,
      token: base.token,
      damage: base.damage,
      rulesetRevision: base.rulesetRevision,
    });
  throw new TypeError('Combat candidate is invalid.');
}

export function validateCombatRulesProfile(raw: unknown): CombatRulesProfile {
  const value = combatData(raw, ['damageMultiplier', 'immuneTargetModes'], 'Combat Ruleset profile');
  if (
    !finite(value.damageMultiplier, 0, 100) ||
    !Array.isArray(value.immuneTargetModes) ||
    value.immuneTargetModes.length > 2 ||
    value.immuneTargetModes.some((mode) => mode !== 'survival' && mode !== 'creative') ||
    new Set(value.immuneTargetModes).size !== value.immuneTargetModes.length
  )
    throw new TypeError('Combat Ruleset profile is invalid.');
  return Object.freeze({
    damageMultiplier: value.damageMultiplier,
    immuneTargetModes: Object.freeze([...value.immuneTargetModes]),
  });
}

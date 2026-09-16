import { validateDurableExecutionOrigin, type DurableExecutionOriginV1 } from '../composition/execution-origin';
import { isEntityLifetimeReference, type EntityLifetimeReference } from '../simulation/action-identity';

export const MAX_COMBAT_FRONTIER_ENTRIES = 1024;
export const MAX_COMBAT_PENDING_HITS = 1024;
export const MAX_COMBAT_MUTATION_IDS = 1024;

export type CombatPendingHit = Readonly<{
  version: 1;
  token: string;
  actorId: string;
  actionId: string;
  definitionId: string;
  targetId: string;
  comboStep: number;
  baseDamage: number;
  remainingSeconds: number;
  actorIdentity: EntityLifetimeReference;
  targetIdentity: EntityLifetimeReference;
  origin: DurableExecutionOriginV1;
}>;

export type CombatPendingHitResolution = Readonly<{
  token: string;
  outcome: 'hit' | 'miss';
  damage: number;
  reason?: string;
}>;

const pendingKeys = [
  'version',
  'token',
  'actorId',
  'actionId',
  'definitionId',
  'targetId',
  'comboStep',
  'baseDamage',
  'remainingSeconds',
  'actorIdentity',
  'targetIdentity',
  'origin',
] as const;

const dataRecord = (raw: unknown, label: string): Record<string, unknown> => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError(`${label} shape is invalid.`);
  const value = raw as Record<string, unknown>;
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !('value' in descriptor)) throw new TypeError(`${label} descriptor is invalid.`);
  }
  return value;
};

export const combatPendingHitToken = (
  actorId: string,
  actionId: string,
  comboStep: number,
  targetLifetime: number,
): string => `combat-hit:${encodeURIComponent(actorId)}:${encodeURIComponent(actionId)}:${comboStep}:${targetLifetime}`;

export function validateCombatPendingHit(raw: unknown): CombatPendingHit {
  const value = dataRecord(raw, 'Combat pending hit');
  const keys = Object.keys(value);
  if (keys.length !== pendingKeys.length || pendingKeys.some((key) => !Object.hasOwn(value, key)))
    throw new TypeError('Combat pending hit shape is invalid.');
  const actorIdentity = value.actorIdentity;
  const targetIdentity = value.targetIdentity;
  if (
    value.version !== 1 ||
    typeof value.token !== 'string' ||
    !value.token.trim() ||
    typeof value.actorId !== 'string' ||
    !value.actorId.trim() ||
    typeof value.actionId !== 'string' ||
    !value.actionId.trim() ||
    typeof value.definitionId !== 'string' ||
    !value.definitionId.trim() ||
    typeof value.targetId !== 'string' ||
    !value.targetId.trim() ||
    !Number.isSafeInteger(value.comboStep) ||
    (value.comboStep as number) < 0 ||
    !Number.isFinite(value.baseDamage) ||
    (value.baseDamage as number) < 0 ||
    !Number.isFinite(value.remainingSeconds) ||
    (value.remainingSeconds as number) < 0 ||
    !isEntityLifetimeReference(actorIdentity) ||
    actorIdentity.entityId !== value.actorId ||
    !isEntityLifetimeReference(targetIdentity) ||
    targetIdentity.entityId !== value.targetId
  )
    throw new TypeError('Combat pending hit is invalid.');
  const expected = combatPendingHitToken(
    value.actorId,
    value.actionId,
    value.comboStep as number,
    targetIdentity.lifetime,
  );
  if (value.token !== expected) throw new TypeError('Combat pending hit token is invalid.');
  const origin = validateDurableExecutionOrigin(value.origin);
  return Object.freeze({
    version: 1,
    token: value.token,
    actorId: value.actorId,
    actionId: value.actionId,
    definitionId: value.definitionId,
    targetId: value.targetId,
    comboStep: value.comboStep as number,
    baseDamage: value.baseDamage as number,
    remainingSeconds: value.remainingSeconds as number,
    actorIdentity: Object.freeze({ ...actorIdentity }),
    targetIdentity: Object.freeze({ ...targetIdentity }),
    origin,
  });
}

export function createCombatPendingHit(value: Omit<CombatPendingHit, 'version' | 'token'>): CombatPendingHit {
  return validateCombatPendingHit({
    version: 1,
    token: combatPendingHitToken(value.actorId, value.actionId, value.comboStep, value.targetIdentity.lifetime),
    ...value,
  });
}

export function validateCombatPendingHitResolution(raw: unknown): CombatPendingHitResolution {
  const value = dataRecord(raw, 'Combat pending hit resolution');
  const keys = Object.keys(value);
  if (
    keys.some((key) => !['token', 'outcome', 'damage', 'reason'].includes(key)) ||
    !Object.hasOwn(value, 'token') ||
    !Object.hasOwn(value, 'outcome') ||
    !Object.hasOwn(value, 'damage') ||
    typeof value.token !== 'string' ||
    !value.token.trim() ||
    (value.outcome !== 'hit' && value.outcome !== 'miss') ||
    !Number.isFinite(value.damage) ||
    (value.damage as number) < 0 ||
    (value.outcome === 'miss' && value.damage !== 0) ||
    (value.reason !== undefined &&
      (typeof value.reason !== 'string' || !value.reason.trim() || value.reason.length > 256))
  )
    throw new TypeError('Combat pending hit resolution is invalid.');
  return Object.freeze({
    token: value.token,
    outcome: value.outcome,
    damage: value.damage as number,
    ...(value.reason === undefined ? {} : { reason: value.reason as string }),
  });
}

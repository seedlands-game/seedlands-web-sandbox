import { chunkKey } from '../../world/voxel';
import { canonicalReferenceInteger } from './network-reference-integer';

export const NETWORK_REFERENCE_INTEREST_CONTROL_VERSION = 1 as const;
export const NETWORK_REFERENCE_INTEREST_CONTROL_MAX_KEYS = 256 as const;

type WireStatus = 'not-adopted';
type RejectionReason = 'invalid-key' | 'over-limit' | 'not-available' | 'residency-pressure';
type CancelScope = 'whole-pending-request' | 'whole-interest' | 'granted-keys';

export type InterestSessionRef = Readonly<{
  epoch: string;
  serverEpoch: string;
  sessionId: string;
  worldId: string;
}>;

export type InterestControlTrustedContext = Readonly<{ ref: InterestSessionRef }>;

export type InterestKeyDemandReference = Readonly<{ key: string; minimumRevision: number }>;
type InterestControlBase = Readonly<{
  projectionVersion: typeof NETWORK_REFERENCE_INTEREST_CONTROL_VERSION;
  wireStatus: WireStatus;
  ref: InterestSessionRef;
}>;

export type InterestRequestReference = InterestControlBase &
  Readonly<{
    kind: 'interest-request-reference';
    requestId: number;
    demand: readonly InterestKeyDemandReference[];
  }>;
export type InterestAcceptedReference = InterestControlBase &
  Readonly<{
    kind: 'interest-accepted-reference';
    requestId: number;
    interestId: number;
    granted: readonly InterestKeyDemandReference[];
    rejected: readonly Readonly<{ key: string; reason: RejectionReason }>[];
  }>;
export type InterestCancelReference = InterestControlBase &
  Readonly<{
    kind: 'interest-cancel-reference';
    requestId: number;
    targetRequestId: number;
    interestId: number | null;
    keys: readonly string[];
  }>;
export type InterestCancelledReference = InterestControlBase &
  Readonly<{
    kind: 'interest-cancelled-reference';
    requestId: number;
    targetRequestId: number;
    interestId: number | null;
    scope: CancelScope;
    keys: readonly string[];
    status: 'cancelled' | 'already-cancelled';
  }>;
export type CollisionBaselineRequestReference = InterestControlBase &
  Readonly<{
    kind: 'collision-baseline-request-reference';
    requestId: number;
    interestId: number | null;
    purpose: 'collision-resync';
    key: string;
    minimumRevision: number;
  }>;

export type InterestControlReference =
  | InterestRequestReference
  | InterestAcceptedReference
  | InterestCancelReference
  | InterestCancelledReference
  | CollisionBaselineRequestReference;

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  !!value && typeof value === 'object' && !Array.isArray(value);

function assertRecord(value: unknown, field: string): UnknownRecord {
  if (!isRecord(value)) throw new TypeError(`${field} must be an object.`);
  return value;
}

function assertExactKeys(value: UnknownRecord, expected: readonly string[], field: string): void {
  const actual = Reflect.ownKeys(value);
  if (actual.length !== expected.length || actual.some((key) => typeof key !== 'string' || !expected.includes(key)))
    throw new TypeError(`${field} contains unknown or missing fields.`);
}

function assertText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256)
    throw new TypeError(`${field} must be non-empty text of at most 256 code units.`);
  return value;
}

function assertIdentifier(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new TypeError(`${field} must be a non-negative safe integer.`);
  return canonicalReferenceInteger(value);
}

function assertDenseArray(value: readonly unknown[], field: string): void {
  for (const key of Reflect.ownKeys(value)) {
    if (key === 'length') continue;
    if (
      typeof key !== 'string' ||
      !/^(0|[1-9]\d*)$/.test(key) ||
      !Number.isSafeInteger(Number(key)) ||
      Number(key) >= value.length
    )
      throw new TypeError(`${field} must not contain extension fields.`);
  }
  for (let index = 0; index < value.length; index += 1)
    if (!(index in value)) throw new TypeError(`${field} must be dense.`);
}

function projectSessionRef(value: unknown, field: string): InterestSessionRef {
  const source = assertRecord(value, field);
  assertExactKeys(source, ['epoch', 'serverEpoch', 'sessionId', 'worldId'], field);
  return {
    epoch: assertText(source.epoch, `${field}.epoch`),
    serverEpoch: assertText(source.serverEpoch, `${field}.serverEpoch`),
    sessionId: assertText(source.sessionId, `${field}.sessionId`),
    worldId: assertText(source.worldId, `${field}.worldId`),
  };
}

function projectTrustedRef(context: InterestControlTrustedContext): InterestSessionRef {
  return projectSessionRef(context.ref, 'trusted context ref');
}

function projectRef(value: unknown, trusted: InterestSessionRef): InterestSessionRef {
  const ref = projectSessionRef(value, 'ref');
  if (
    ref.epoch !== trusted.epoch ||
    ref.serverEpoch !== trusted.serverEpoch ||
    ref.sessionId !== trusted.sessionId ||
    ref.worldId !== trusted.worldId
  )
    throw new TypeError('ref must match the trusted session context.');
  return ref;
}

function projectChunkKey(value: unknown, field: string): string {
  const key = assertText(value, field);
  const coordinates = key.split(',').map(Number);
  if (
    coordinates.length !== 3 ||
    coordinates.some((coordinate) => !Number.isSafeInteger(coordinate)) ||
    chunkKey(coordinates[0]!, coordinates[1]!, coordinates[2]!) !== key
  )
    throw new TypeError(`${field} must be a canonical chunk key.`);
  return key;
}

function assertUnique(keys: readonly string[], field: string): void {
  if (new Set(keys).size !== keys.length) throw new TypeError(`${field} must not contain duplicate keys.`);
}

function projectKeys(value: unknown, field: string, minimum: number): string[] {
  if (!Array.isArray(value)) throw new TypeError(`${field} must be an array.`);
  if (value.length < minimum || value.length > NETWORK_REFERENCE_INTEREST_CONTROL_MAX_KEYS)
    throw new RangeError(`${field} must contain ${minimum}..${NETWORK_REFERENCE_INTEREST_CONTROL_MAX_KEYS} keys.`);
  assertDenseArray(value, field);
  const keys = value.map((key) => projectChunkKey(key, field));
  assertUnique(keys, field);
  return keys;
}

function projectDemand(value: unknown, field: string, minimum: number): InterestKeyDemandReference[] {
  if (!Array.isArray(value)) throw new TypeError(`${field} must be an array.`);
  if (value.length < minimum || value.length > NETWORK_REFERENCE_INTEREST_CONTROL_MAX_KEYS)
    throw new RangeError(`${field} must contain ${minimum}..${NETWORK_REFERENCE_INTEREST_CONTROL_MAX_KEYS} entries.`);
  assertDenseArray(value, field);
  const demand = value.map((entry, index) => {
    const source = assertRecord(entry, `${field}[${index}]`);
    assertExactKeys(source, ['key', 'minimumRevision'], `${field}[${index}]`);
    return {
      key: projectChunkKey(source.key, `${field}[${index}].key`),
      minimumRevision: assertIdentifier(source.minimumRevision, `${field}[${index}].minimumRevision`),
    };
  });
  assertUnique(
    demand.map(({ key }) => key),
    field,
  );
  return demand;
}

function projectBase(
  value: unknown,
  trusted: InterestSessionRef,
  kind: InterestControlReference['kind'],
  fields: readonly string[],
): UnknownRecord & InterestControlBase {
  const source = assertRecord(value, kind);
  assertExactKeys(source, ['kind', 'projectionVersion', 'wireStatus', 'ref', ...fields], kind);
  if (source.kind !== kind) throw new TypeError(`Expected ${kind}.`);
  if (source.projectionVersion !== NETWORK_REFERENCE_INTEREST_CONTROL_VERSION)
    throw new TypeError(`${kind}.projectionVersion is invalid.`);
  if (source.wireStatus !== 'not-adopted') throw new TypeError(`${kind}.wireStatus is invalid.`);
  return {
    ...source,
    projectionVersion: NETWORK_REFERENCE_INTEREST_CONTROL_VERSION,
    wireStatus: 'not-adopted',
    ref: projectRef(source.ref, trusted),
  };
}

function projectInterestId(value: unknown, field: string): number | null {
  return value === null ? null : assertIdentifier(value, field);
}

function projectRequest(value: unknown, trusted: InterestSessionRef): InterestRequestReference {
  const source = projectBase(value, trusted, 'interest-request-reference', ['requestId', 'demand']);
  return {
    ...source,
    kind: 'interest-request-reference',
    requestId: assertIdentifier(source.requestId, 'requestId'),
    demand: projectDemand(source.demand, 'demand', 1),
  };
}

function projectAccepted(value: unknown, trusted: InterestSessionRef): InterestAcceptedReference {
  const source = projectBase(value, trusted, 'interest-accepted-reference', [
    'requestId',
    'interestId',
    'granted',
    'rejected',
  ]);
  if (!Array.isArray(source.granted) || !Array.isArray(source.rejected))
    throw new TypeError('granted and rejected must be arrays.');
  if (
    source.granted.length + source.rejected.length < 1 ||
    source.granted.length + source.rejected.length > NETWORK_REFERENCE_INTEREST_CONTROL_MAX_KEYS
  )
    throw new RangeError(
      `granted and rejected must contain 1..${NETWORK_REFERENCE_INTEREST_CONTROL_MAX_KEYS} entries.`,
    );
  const granted = projectDemand(source.granted, 'granted', 0);
  assertDenseArray(source.rejected, 'rejected');
  const rejected = source.rejected.map((entry, index) => {
    const item = assertRecord(entry, `rejected[${index}]`);
    assertExactKeys(item, ['key', 'reason'], `rejected[${index}]`);
    if (!['invalid-key', 'over-limit', 'not-available', 'residency-pressure'].includes(item.reason as string))
      throw new TypeError(`rejected[${index}].reason is invalid.`);
    return { key: projectChunkKey(item.key, `rejected[${index}].key`), reason: item.reason as RejectionReason };
  });
  assertUnique([...granted.map(({ key }) => key), ...rejected.map(({ key }) => key)], 'granted and rejected');
  return {
    ...source,
    kind: 'interest-accepted-reference',
    requestId: assertIdentifier(source.requestId, 'requestId'),
    interestId: assertIdentifier(source.interestId, 'interestId'),
    granted,
    rejected,
  };
}

function assertDifferentIds(requestId: number, targetRequestId: number): void {
  if (requestId === targetRequestId) throw new TypeError('requestId and targetRequestId must be different.');
}

function projectCancel(value: unknown, trusted: InterestSessionRef): InterestCancelReference {
  const source = projectBase(value, trusted, 'interest-cancel-reference', [
    'requestId',
    'targetRequestId',
    'interestId',
    'keys',
  ]);
  const requestId = assertIdentifier(source.requestId, 'requestId');
  const targetRequestId = assertIdentifier(source.targetRequestId, 'targetRequestId');
  assertDifferentIds(requestId, targetRequestId);
  const interestId = projectInterestId(source.interestId, 'interestId');
  const keys = projectKeys(source.keys, 'keys', 0);
  if (interestId === null && keys.length !== 0) throw new TypeError('null interestId requires empty keys.');
  return { ...source, kind: 'interest-cancel-reference', requestId, targetRequestId, interestId, keys };
}

function projectCancelled(value: unknown, trusted: InterestSessionRef): InterestCancelledReference {
  const source = projectBase(value, trusted, 'interest-cancelled-reference', [
    'requestId',
    'targetRequestId',
    'interestId',
    'scope',
    'keys',
    'status',
  ]);
  const requestId = assertIdentifier(source.requestId, 'requestId');
  const targetRequestId = assertIdentifier(source.targetRequestId, 'targetRequestId');
  assertDifferentIds(requestId, targetRequestId);
  const interestId = projectInterestId(source.interestId, 'interestId');
  const scope = source.scope;
  const keys = projectKeys(source.keys, 'keys', scope === 'granted-keys' ? 1 : 0);
  if (!['whole-pending-request', 'whole-interest', 'granted-keys'].includes(scope as string))
    throw new TypeError('cancelled scope is invalid.');
  if (source.status !== 'cancelled' && source.status !== 'already-cancelled')
    throw new TypeError('cancelled status is invalid.');
  if (
    (scope === 'whole-pending-request' && (interestId !== null || keys.length !== 0)) ||
    (scope === 'whole-interest' && (interestId === null || keys.length !== 0)) ||
    (scope === 'granted-keys' && interestId === null)
  )
    throw new TypeError('cancelled scope, interestId, and keys are inconsistent.');
  return {
    ...source,
    kind: 'interest-cancelled-reference',
    requestId,
    targetRequestId,
    interestId,
    scope: scope as CancelScope,
    keys,
    status: source.status,
  };
}

function projectCollision(value: unknown, trusted: InterestSessionRef): CollisionBaselineRequestReference {
  const source = projectBase(value, trusted, 'collision-baseline-request-reference', [
    'requestId',
    'interestId',
    'purpose',
    'key',
    'minimumRevision',
  ]);
  if (source.purpose !== 'collision-resync') throw new TypeError('collision baseline purpose is invalid.');
  return {
    ...source,
    kind: 'collision-baseline-request-reference',
    requestId: assertIdentifier(source.requestId, 'requestId'),
    interestId: projectInterestId(source.interestId, 'interestId'),
    purpose: 'collision-resync',
    key: projectChunkKey(source.key, 'key'),
    minimumRevision: assertIdentifier(source.minimumRevision, 'minimumRevision'),
  };
}

export function projectInterestControlReference(
  value: unknown,
  context: InterestControlTrustedContext,
): InterestControlReference {
  const trusted = projectTrustedRef(context);
  const kind = assertRecord(value, 'interest control').kind;
  if (kind === 'interest-request-reference') return projectRequest(value, trusted);
  if (kind === 'interest-accepted-reference') return projectAccepted(value, trusted);
  if (kind === 'interest-cancel-reference') return projectCancel(value, trusted);
  if (kind === 'interest-cancelled-reference') return projectCancelled(value, trusted);
  if (kind === 'collision-baseline-request-reference') return projectCollision(value, trusted);
  throw new TypeError('interest control kind is invalid.');
}

export function validateInterestControlReference(value: unknown, context: InterestControlTrustedContext): boolean {
  try {
    projectInterestControlReference(value, context);
    return true;
  } catch {
    return false;
  }
}

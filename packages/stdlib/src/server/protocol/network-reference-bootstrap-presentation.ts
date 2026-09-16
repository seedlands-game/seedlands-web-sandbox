import type { AuthoritySnapshot } from '../authority/authority-session-types';
import type { AuthorityReady } from '../protocol/authority-worker-protocol';
import { projectWelcomeReference } from './network-reference-bootstrap';
import type { ReferenceBootstrapContext, WelcomeReference } from './network-reference-bootstrap-types';
import { canonicalReferenceInteger } from './network-reference-integer';

export const WELCOME_PRESENTATION_REFERENCE_VERSION = 2 as const;

type WelcomePlayerBodyReference = Readonly<{
  position: Readonly<{ x: number; y: number; z: number }>;
  velocity: Readonly<{ x: number; y: number; z: number }>;
  grounded: boolean;
}>;

export type WelcomePresentationReferenceV2 = Omit<
  WelcomeReference,
  'kind' | 'projectionVersion' | 'initialCheckpoint'
> &
  Readonly<{
    kind: 'welcome-presentation-reference';
    projectionVersion: typeof WELCOME_PRESENTATION_REFERENCE_VERSION;
    initialCheckpoint: Readonly<{
      physicsTick: number;
      commitSequence: number;
      worldRevision: number;
      durableCommitSequence: number;
    }>;
    playerBody: WelcomePlayerBodyReference;
    /** Authority 启动事实；不能解释为当前连接首次 attach。 */
    authorityStartPresentation: Readonly<{
      authorityStartPlayerWasCreated: boolean;
      campPosition: readonly [number, number, number] | null;
    }>;
  }>;

const nonNegativeSafeInteger = (value: unknown, field: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new TypeError(`${field} must be a non-negative safe integer.`);
  return canonicalReferenceInteger(value);
};

const nonNegativeFinite = (value: unknown, field: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    throw new TypeError(`${field} must be finite and non-negative.`);
  return value;
};

const finite = (value: unknown, field: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${field} must be finite.`);
  return value;
};

const vector = (value: unknown, field: string): WelcomePlayerBodyReference['position'] => {
  if (!value || typeof value !== 'object') throw new TypeError(`${field} must be a vector.`);
  const candidate = value as Record<string, unknown>;
  return {
    x: finite(candidate.x, `${field}.x`),
    y: finite(candidate.y, `${field}.y`),
    z: finite(candidate.z, `${field}.z`),
  };
};

const campPosition = (value: unknown): readonly [number, number, number] | null => {
  if (value === undefined) return null;
  if (!Array.isArray(value) || value.length !== 3) throw new TypeError('ready.campPosition must be a vector tuple.');
  return [
    finite(value[0], 'ready.campPosition[0]'),
    finite(value[1], 'ready.campPosition[1]'),
    finite(value[2], 'ready.campPosition[2]'),
  ];
};

const assertCurrentSnapshot = (ready: AuthorityReady, current: AuthoritySnapshot) => {
  if (ready.snapshot.epoch !== current.epoch)
    throw new TypeError('currentSnapshot.epoch must match ready.snapshot.epoch.');
  if (ready.snapshot.player.id !== ready.playerId)
    throw new TypeError('ready.snapshot.player.id must match ready.playerId.');
  if (current.player.id !== ready.playerId) throw new TypeError('currentSnapshot.player.id must match ready.playerId.');

  const anchors = [
    ['physicsTick', nonNegativeSafeInteger(ready.snapshot.physicsTick, 'ready.snapshot.physicsTick')],
    ['commitSequence', nonNegativeSafeInteger(ready.snapshot.commitSequence, 'ready.snapshot.commitSequence')],
    ['worldRevision', nonNegativeSafeInteger(ready.snapshot.worldRevision, 'ready.snapshot.worldRevision')],
  ] as const;
  for (const [field, initial] of anchors) {
    const value = nonNegativeSafeInteger(current[field], `currentSnapshot.${field}`);
    if (value < initial) throw new RangeError(`currentSnapshot.${field} cannot be older than the ready snapshot.`);
  }
  const initialActiveTime = nonNegativeFinite(ready.snapshot.activeTimeMs, 'ready.snapshot.activeTimeMs');
  const currentActiveTime = nonNegativeFinite(current.activeTimeMs, 'currentSnapshot.activeTimeMs');
  if (currentActiveTime < initialActiveTime)
    throw new RangeError('currentSnapshot.activeTimeMs cannot be older than the ready snapshot.');
};

export function projectWelcomePresentationReference(
  ready: AuthorityReady,
  currentSnapshot: AuthoritySnapshot,
  context: ReferenceBootstrapContext,
): WelcomePresentationReferenceV2 {
  assertCurrentSnapshot(ready, currentSnapshot);
  if (typeof ready.isNew !== 'boolean') throw new TypeError('ready.isNew must be boolean.');
  if (
    typeof currentSnapshot.worldTime !== 'number' ||
    !Number.isFinite(currentSnapshot.worldTime) ||
    currentSnapshot.worldTime < 0 ||
    currentSnapshot.worldTime >= 24
  )
    throw new TypeError('currentSnapshot.worldTime must be in the production range [0, 24).');
  if (typeof currentSnapshot.player.grounded !== 'boolean')
    throw new TypeError('currentSnapshot.player.grounded must be boolean.');

  const currentReady: AuthorityReady = {
    ...ready,
    playerBodyPosition: [
      currentSnapshot.player.body.position.x,
      currentSnapshot.player.body.position.y,
      currentSnapshot.player.body.position.z,
    ],
    worldTime: currentSnapshot.worldTime,
    snapshot: currentSnapshot,
  };
  const base = projectWelcomeReference(currentReady, context);
  return {
    ...base,
    kind: 'welcome-presentation-reference',
    projectionVersion: WELCOME_PRESENTATION_REFERENCE_VERSION,
    initialCheckpoint: {
      physicsTick: nonNegativeSafeInteger(currentSnapshot.physicsTick, 'currentSnapshot.physicsTick'),
      ...base.initialCheckpoint,
    },
    playerBody: {
      position: vector(currentSnapshot.player.body.position, 'currentSnapshot.player.body.position'),
      velocity: vector(currentSnapshot.player.body.velocity, 'currentSnapshot.player.body.velocity'),
      grounded: currentSnapshot.player.grounded,
    },
    authorityStartPresentation: {
      authorityStartPlayerWasCreated: ready.isNew,
      campPosition: campPosition(ready.campPosition),
    },
  };
}

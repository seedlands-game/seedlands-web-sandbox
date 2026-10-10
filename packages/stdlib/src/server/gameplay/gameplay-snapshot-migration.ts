import type { ModModule } from '../composition/contracts';
import type { CompositionCheckpointIdentity } from '../composition/checkpoint-identity';
import {
  canonicalCompositionCheckpointIdentity,
  cloneCompositionCheckpointIdentity,
} from '../composition/checkpoint-identity';

const MAX_GAMEPLAY_SNAPSHOT_PREDECESSORS = 16;
export type LegacyGameplaySnapshotVersion = 1 | 2 | 3 | 4;
export type GameplaySnapshotPredecessorV1 = Readonly<{
  gameplayVersions: readonly LegacyGameplaySnapshotVersion[];
  identity: CompositionCheckpointIdentity;
}>;

/** A Pack-owned, user-visible account of one restore-time compatibility change. */
export type GameplaySnapshotMigrationReport = Readonly<{
  id: string;
  removedActorIds: readonly string[];
}>;

export type GameplaySnapshotMigrationContext = Readonly<{
  targetComposition: CompositionCheckpointIdentity | null;
}>;

export type GameplaySnapshotMigration = Readonly<{
  predecessors?: readonly GameplaySnapshotPredecessorV1[];
  migrate(
    snapshot: unknown,
    context: GameplaySnapshotMigrationContext,
  ): Readonly<{ snapshot: unknown; reports: readonly GameplaySnapshotMigrationReport[] }>;
}>;

const dataProperty = (owner: object, key: PropertyKey, label: string): unknown => {
  const descriptor = Object.getOwnPropertyDescriptor(owner, key);
  if (!descriptor) throw new TypeError(`${label} must be a bounded dense array.`);
  if (!('value' in descriptor)) throw new TypeError(`${label} accessors are forbidden.`);
  return descriptor.value;
};

const denseDataArray = (raw: unknown, maximum: number, label: string): readonly unknown[] => {
  if (!Array.isArray(raw)) throw new TypeError(`${label} must be a bounded dense array.`);
  const length = dataProperty(raw, 'length', label);
  if (!Number.isSafeInteger(length) || (length as number) < 0 || (length as number) > maximum)
    throw new TypeError(`${label} must be a bounded dense array.`);
  const values: unknown[] = [];
  for (let index = 0; index < (length as number); index += 1) values.push(dataProperty(raw, String(index), label));
  if (Reflect.ownKeys(raw).length !== values.length + 1) throw new TypeError(`${label} must be a bounded dense array.`);
  return values;
};

const predecessorFields = (raw: unknown): Readonly<{ gameplayVersions: unknown; identity: unknown }> => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new TypeError('Gameplay snapshot predecessor is invalid.');
  const keys = Reflect.ownKeys(raw);
  if (keys.length !== 2 || !keys.includes('gameplayVersions') || !keys.includes('identity'))
    throw new TypeError('Gameplay snapshot predecessor has an invalid shape.');
  return {
    gameplayVersions: dataProperty(raw, 'gameplayVersions', 'Gameplay snapshot predecessor'),
    identity: dataProperty(raw, 'identity', 'Gameplay snapshot predecessor'),
  };
};

export function defineGameplaySnapshotPredecessorsV1(
  raw: readonly GameplaySnapshotPredecessorV1[] = [],
): readonly GameplaySnapshotPredecessorV1[] {
  const entries = denseDataArray(raw, MAX_GAMEPLAY_SNAPSHOT_PREDECESSORS, 'Gameplay snapshot predecessors');
  const identities = new Set<string>();
  return Object.freeze(
    entries.map((rawEntry) => {
      const entry = predecessorFields(rawEntry);
      const versionValues = denseDataArray(entry.gameplayVersions, 4, 'Gameplay snapshot predecessor versions');
      if (versionValues.length === 0)
        throw new TypeError('Gameplay snapshot predecessor versions must be a non-empty dense array.');
      if (versionValues.some((value) => value !== 1 && value !== 2 && value !== 3 && value !== 4))
        throw new TypeError('Gameplay snapshot predecessor version is invalid.');
      const versions = (versionValues as readonly LegacyGameplaySnapshotVersion[])
        .slice()
        .sort((left, right) => left - right);
      if (new Set(versions).size !== versions.length)
        throw new TypeError('Gameplay snapshot predecessor versions must be unique.');
      const identity = cloneCompositionCheckpointIdentity(entry.identity);
      const key = canonicalCompositionCheckpointIdentity(identity);
      if (identities.has(key)) throw new TypeError('Gameplay snapshot predecessor identity is duplicated.');
      identities.add(key);
      return Object.freeze({
        gameplayVersions: Object.freeze(versions),
        identity,
      });
    }),
  );
}

export function matchesGameplaySnapshotPredecessorV1(
  predecessors: readonly GameplaySnapshotPredecessorV1[],
  gameplayVersion: number,
  identity: unknown,
): boolean {
  const candidate = canonicalCompositionCheckpointIdentity(cloneCompositionCheckpointIdentity(identity));
  return predecessors.some(
    (predecessor) =>
      predecessor.gameplayVersions.includes(gameplayVersion as LegacyGameplaySnapshotVersion) &&
      canonicalCompositionCheckpointIdentity(predecessor.identity) === candidate,
  );
}

export const GAMEPLAY_SNAPSHOT_MIGRATION_CAPABILITY = 'seedlands:gameplay-snapshot-migration';

/**
 * Registers one Pack-owned snapshot projection. It runs after the generic
 * envelope check and before the composition guard verifies the projected save.
 */
export function defineGameplaySnapshotMigrationModule(
  input: Readonly<{ moduleId: string; migration: GameplaySnapshotMigration }>,
): ModModule {
  const predecessors = defineGameplaySnapshotPredecessorsV1(input.migration.predecessors);
  const migration = Object.freeze({ ...input.migration, predecessors });
  return Object.freeze({
    descriptor: {
      id: input.moduleId,
      version: '1.0.0',
      provides: [{ id: GAMEPLAY_SNAPSHOT_MIGRATION_CAPABILITY, version: '1.0.0' }],
    },
    register(api) {
      api.provideCapability(GAMEPLAY_SNAPSHOT_MIGRATION_CAPABILITY, migration);
    },
  } satisfies ModModule);
}

import { describe, expect, it } from 'vitest';
import {
  defineGameplaySnapshotPredecessorsV1,
  matchesGameplaySnapshotPredecessorV1,
  type GameplaySnapshotPredecessorV1,
  type LegacyGameplaySnapshotVersion,
} from '../../src/server/gameplay/gameplay-snapshot-migration';
import {
  canonicalCompositionCheckpointIdentity,
  createCompositionCheckpointGuard,
  type CompositionCheckpointIdentity,
} from '../../src/server/composition/checkpoint-identity';
import type { WorldComposition } from '../../src/server/composition/contracts';

const digest = (value: string) => value.repeat(64);
const identity = (suffix: string): CompositionCheckpointIdentity => ({
  version: 1,
  playbookId: 'sample:world',
  packLock: [
    {
      id: 'sample:world',
      version: '1.0.0',
      integrity: { algorithm: 'sha256', manifestDigest: digest(suffix), entryDigest: digest('b'), resources: [] },
    },
  ],
  definitionMap: {
    schemaVersion: 2,
    stateCodecs: [],
    operations: [],
    rules: [],
    packs: [{ id: 'sample:world', version: '1.0.0' }],
    modules: [{ id: 'sample:content', version: '1.0.0', packId: 'sample:world' }],
    capabilities: [{ id: 'sample:items', version: '1.0.0', moduleId: 'sample:content' }],
    resources: [],
    items: [],
    recipes: [],
    voxels: [],
    systems: [],
    lifecycles: [],
  },
});
const composition = (value: CompositionCheckpointIdentity): WorldComposition =>
  ({ playbookId: value.playbookId, packLock: value.packLock, definitionMap: value.definitionMap }) as WorldComposition;

describe('Gameplay snapshot predecessor declarations', () => {
  it('clones and deep-freezes a bounded exact predecessor declaration', () => {
    const source = [{ gameplayVersions: [1, 3], identity: identity('a') }] as GameplaySnapshotPredecessorV1[];
    const frozen = defineGameplaySnapshotPredecessorsV1(source);
    (source[0]!.gameplayVersions as number[])[0] = 2;
    (source[0]!.identity.packLock[0]!.integrity.resources as Array<{ path: string; digest: string }>).push({
      path: 'tampered',
      digest: digest('c'),
    });

    expect(frozen).toEqual([{ gameplayVersions: [1, 3], identity: identity('a') }]);
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen[0]!.gameplayVersions)).toBe(true);
    expect(Object.isFrozen(frozen[0]!.identity.definitionMap.modules[0])).toBe(true);
  });

  it.each([
    ['empty versions', [{ gameplayVersions: [], identity: identity('a') }]],
    ['duplicate versions', [{ gameplayVersions: [1, 1], identity: identity('a') }]],
    ['invalid version', [{ gameplayVersions: [5], identity: identity('a') }]],
    [
      'duplicate identity',
      [
        { gameplayVersions: [1], identity: identity('a') },
        { gameplayVersions: [3], identity: identity('a') },
      ],
    ],
    [
      'too many predecessors',
      Array.from({ length: 17 }, (_, index) => ({ gameplayVersions: [1], identity: identity(String(index % 10)) })),
    ],
  ])('rejects %s', (_label, value) => {
    expect(() => defineGameplaySnapshotPredecessorsV1(value as GameplaySnapshotPredecessorV1[])).toThrow();
  });

  it('rejects sparse declarations and malformed identities', () => {
    expect(() => defineGameplaySnapshotPredecessorsV1(Array(1))).toThrow(/dense/i);
    expect(() =>
      defineGameplaySnapshotPredecessorsV1([
        { gameplayVersions: [3], identity: { ...identity('a'), playbookId: 'not-qualified' } },
      ]),
    ).toThrow(/playbook id/i);
  });

  it('rejects sparse declarations even when named properties imitate a dense key count', () => {
    const predecessors = Array(2) as GameplaySnapshotPredecessorV1[];
    Object.defineProperty(predecessors, 0, {
      value: { gameplayVersions: [1], identity: identity('a') },
      enumerable: true,
    });
    Object.defineProperty(predecessors, 'named', { value: true, enumerable: true });

    expect(() => defineGameplaySnapshotPredecessorsV1(predecessors)).toThrow(/dense/i);
  });

  it('rejects accessors without invoking predecessor or version input code', () => {
    let reads = 0;
    const indexAccessor = Array(1) as GameplaySnapshotPredecessorV1[];
    Object.defineProperty(indexAccessor, 0, {
      enumerable: true,
      get() {
        reads += 1;
        return { gameplayVersions: [1], identity: identity('a') };
      },
    });
    expect(() => defineGameplaySnapshotPredecessorsV1(indexAccessor)).toThrow(/accessor/i);
    expect(reads).toBe(0);

    const entryAccessor = {} as GameplaySnapshotPredecessorV1;
    Object.defineProperties(entryAccessor, {
      gameplayVersions: {
        enumerable: true,
        get() {
          reads += 1;
          return [1];
        },
      },
      identity: { value: identity('a'), enumerable: true },
    });
    expect(() => defineGameplaySnapshotPredecessorsV1([entryAccessor])).toThrow(/accessor/i);
    expect(reads).toBe(0);

    const versions = Array(1) as unknown as LegacyGameplaySnapshotVersion[];
    Object.defineProperty(versions, 0, {
      enumerable: true,
      get() {
        reads += 1;
        return 1;
      },
    });
    expect(() =>
      defineGameplaySnapshotPredecessorsV1([{ gameplayVersions: versions, identity: identity('a') }]),
    ).toThrow(/accessor/i);
    expect(reads).toBe(0);
  });

  it('rejects sparse version arrays even when named properties imitate a dense key count', () => {
    const versions = Array(2) as LegacyGameplaySnapshotVersion[];
    Object.defineProperty(versions, 0, { value: 1, enumerable: true });
    Object.defineProperty(versions, 'named', { value: true, enumerable: true });

    expect(() =>
      defineGameplaySnapshotPredecessorsV1([{ gameplayVersions: versions, identity: identity('a') }]),
    ).toThrow(/dense/i);
  });

  it('rejects invalid versions before sort can invoke coercion hooks', () => {
    let coercions = 0;
    const malicious = {
      [Symbol.toPrimitive]() {
        coercions += 1;
        return 2;
      },
    };

    expect(() =>
      defineGameplaySnapshotPredecessorsV1([
        {
          gameplayVersions: [malicious, 1] as unknown as LegacyGameplaySnapshotVersion[],
          identity: identity('a'),
        },
      ]),
    ).toThrow(/version is invalid/i);
    expect(coercions).toBe(0);
  });

  it('rejects equivalent malformed arrays inside canonical identities without invoking accessors', () => {
    const sparsePackLock = Array(2);
    Object.defineProperty(sparsePackLock, 0, { value: identity('a').packLock[0], enumerable: true });
    Object.defineProperty(sparsePackLock, 'named', { value: true, enumerable: true });
    const sparseIdentity = { ...identity('a'), packLock: sparsePackLock } as unknown as CompositionCheckpointIdentity;
    expect(() => canonicalCompositionCheckpointIdentity(sparseIdentity)).toThrow(/dense/i);

    let reads = 0;
    const accessorPackLock = Array(1);
    Object.defineProperty(accessorPackLock, 0, {
      enumerable: true,
      get() {
        reads += 1;
        return identity('a').packLock[0];
      },
    });
    const accessorIdentity = {
      ...identity('a'),
      packLock: accessorPackLock,
    } as unknown as CompositionCheckpointIdentity;
    expect(() => canonicalCompositionCheckpointIdentity(accessorIdentity)).toThrow(/accessor/i);
    expect(reads).toBe(0);
  });

  it('admits an exact V3 source independently of later target modules and rejects near misses', () => {
    const source = identity('a');
    const target = identity('c');
    (target.definitionMap.modules as Array<{ id: string; version: string; packId: string }>).push({
      id: 'sample:new-module',
      version: '1.0.0',
      packId: 'sample:world',
    });
    const predecessors = defineGameplaySnapshotPredecessorsV1([{ gameplayVersions: [3, 4], identity: source }]);
    const guard = createCompositionCheckpointGuard(composition(target), source, predecessors);

    expect(() => guard.validateGameplay({ version: 3 })).not.toThrow();
    expect(matchesGameplaySnapshotPredecessorV1(predecessors, 4, source)).toBe(true);
    expect(() =>
      createCompositionCheckpointGuard(composition(target), undefined, predecessors).validateGameplay({ version: 3 }),
    ).toThrow(/unavailable/i);
    expect(() =>
      createCompositionCheckpointGuard(composition(target), source, predecessors).validateGameplay({ version: 2 }),
    ).toThrow(/approved predecessor/i);

    const changedDigest: CompositionCheckpointIdentity = {
      ...source,
      packLock: source.packLock.map((entry, index) =>
        index === 0 ? { ...entry, integrity: { ...entry.integrity, entryDigest: digest('d') } } : entry,
      ),
    };
    expect(() =>
      createCompositionCheckpointGuard(composition(target), changedDigest, predecessors).validateGameplay({
        version: 3,
      }),
    ).toThrow(/approved predecessor/i);
    const changedGraph: CompositionCheckpointIdentity = {
      ...source,
      definitionMap: {
        ...source.definitionMap,
        modules: source.definitionMap.modules.slice(0, -1),
      },
    };
    expect(() =>
      createCompositionCheckpointGuard(composition(target), changedGraph, predecessors).validateGameplay({
        version: 3,
      }),
    ).toThrow(/approved predecessor/i);
  });

  it('does not give a non-Classic composition an undeclared predecessor or accept an unmigrated V4 source', () => {
    const source = identity('a');
    const target = identity('c');
    const predecessors = defineGameplaySnapshotPredecessorsV1([{ gameplayVersions: [3, 4], identity: source }]);

    expect(() =>
      createCompositionCheckpointGuard(composition(target), source).validateGameplay({ version: 3 }),
    ).toThrow(/approved predecessor/i);
    expect(() =>
      createCompositionCheckpointGuard(composition(target), source, predecessors).validateGameplay({
        version: 4,
        composition: source,
      }),
    ).toThrow(/incompatible/i);
    expect(() =>
      createCompositionCheckpointGuard(composition(target), source, predecessors).validateGameplay({
        version: 4,
        composition: target,
      }),
    ).not.toThrow();
  });
});
